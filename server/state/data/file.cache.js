const _ = require("lodash");
const Logger = require("../../handlers/logger.js");
const { getUnits, getCost } = require("../../utils/spool.utils");
const { getPrintCostNumeric } = require("../../utils/print-cost.util");
const { getDefaultFileCleanStatistics } = require("../../constants/cleaner.constants");
const { findFileIndex } = require("../../services/utils/find-predicate.utils");
const { getFileCacheDefault } = require("../../constants/cache.constants");
const { ValidationException } = require("../../exceptions/runtime.exceptions");
const { Status } = require("../../constants/service.constants");

/**
 * A generic cache for file references, which will be abstracted in future to allow for proxy files and local files.
 */
class FileCache {
  // Associative array
  #printerFileStorage = {}; // Ass. array [Id] : { fileList, storage }
  #totalFileCount = 0;
  #fileStatistics = getDefaultFileCleanStatistics();

  #logger = new Logger("Server-FileCache");

  constructor({}) {}

  /**
   * Save a printer storage reference to cache
   * @param printerId
   * @param fileList
   * @param storage
   */
  cachePrinterFileStorage(printerId, { fileList, storage }) {
    this.cachePrinterStorage(printerId, storage);

    this.cachePrinterFiles(printerId, fileList);
  }

  cachePrinterFiles(printerID, fileList) {
    const printerFileStorage = this.#getPrinterFileStorage(printerID);

    printerFileStorage.fileList = fileList;

    this.updateCacheFileRefCount();
  }

  cachePrinterStorage(printerId, storage) {
    const printerFileStorage = this.#getPrinterFileStorage(printerId);

    printerFileStorage.storage = storage;

    this.updateCacheFileRefCount();
  }

  #getPrinterFileStorage(printerId) {
    if (!printerId) {
      throw new Error("File Cache cant get a null/undefined printer id");
    }

    let fileStorage = this.#printerFileStorage[printerId];

    if (!fileStorage) {
      // A runtime thing only, repository handles it differently
      fileStorage = this.#printerFileStorage[printerId] = getFileCacheDefault();
    }

    return fileStorage;
  }

  getStatistics() {
    return this.#fileStatistics;
  }

  getPrinterFiles(printerId) {
    const fileStorage = this.#getPrinterFileStorage(printerId);
    return fileStorage?.fileList;
  }

  getPrinterStorage(printerId) {
    const fileStorage = this.#getPrinterFileStorage(printerId);
    return fileStorage?.storage;
  }

  updateCacheFileRefCount() {
    let totalFiles = 0;
    for (const storage of Object.values(this.#printerFileStorage)) {
      totalFiles += storage.fileList.files?.length || 0;
    }

    if (totalFiles !== this.#totalFileCount) {
      this.#totalFileCount = totalFiles;
      this.#logger.info(`Cache updated. ${this.#totalFileCount} file storage references cached.`);
    }

    return totalFiles;
  }

  purgePrinterId(printerId) {
    if (!printerId) {
      throw new ValidationException("Parameter printerId was not provided.");
    }

    const fileStorage = this.#printerFileStorage[printerId];

    if (!fileStorage) {
      this.#logger.warning("Did not remove printer File Storage as it was not found");
      return;
    }

    delete this.#printerFileStorage[printerId];

    this.#logger.info(`Purged printerId '${printerId}' file cache`);
  }

  purgeFile(printerId, filePath) {
    const { fileList } = this.#getPrinterFileStorage(printerId);

    const fileIndex = findFileIndex(fileList, filePath);
    if (fileIndex === -1) {
      // We can always choose to throw - if we trust the cache consistency
      this.#logger.warning(
        `A file removal was ordered but this file was not found in files cache for printer Id ${printerId}`,
        filePath
      );

      return Status.failure("File was not found in cached printer fileList");
    }

    fileList.files.splice(fileIndex, 1);

    return Status.success("File was removed");
  }

  // TODO convert this to a toFlat() implementation
  // Currently unused
  saveFileList(printerID, fileList, printerCostSettings, selectedFilament) {
    // TODO check if exists and create if not
    const printerFileStorage = this.#printerFileStorage[printerID];

    const sortedFileList = [];
    if (!!fileList?.files) {
      for (let file of fileList.files) {
        const fileToolUnits = getUnits(selectedFilament, file.length) || "";
        const sortedFile = {
          path: file.path,
          fullPath: file.fullPath,
          display: file.display,
          name: file.name,
          uploadDate: file.date,
          fileSize: file.size,
          thumbnail: file.thumbnail,
          success: file.success,
          failed: file.failed,
          last: file.last,
          // TODO the props below are 'extra'
          expectedPrintTime: file.time,
          // TODO these have no place in a file cache - derivatives
          printCost: getPrintCostNumeric(file.time, printerCostSettings),
          toolUnits: fileToolUnits,
          toolCosts: getCost(selectedFilament, fileToolUnits) || ""
        };

        sortedFileList.push(sortedFile);
      }
    }

    printerFileStorage.fileList = {
      fileList: sortedFileList,
      folderList: fileList.folders || [],
      folderCount: fileList.folderCount || 0
    };
  }

  // TODO
  statistics(farmPrinters) {
    const storageFree = [];
    const storageTotal = [];
    const devices = [];
    const fileSizes = [];
    const fileLengths = [];
    const fileCount = [];
    const folderCount = [];

    // Collect unique devices - Total for farm storage should not duplicate storage on instances running on same devices.
    farmPrinters.forEach((printer, index) => {
      if (!!printer.storage) {
        const device = {
          ip: printer.printerURL,
          index: printer.index,
          storage: printer.storage
        };
        devices.push(device);
      }
      if (!!printer.fileList) {
        printer.fileList.files?.forEach((file) => {
          if (!isNaN(file.size)) {
            fileSizes.push(file.size);
          }
          if (!isNaN(file.length)) {
            fileLengths.push(file.length / 1000);
          }

          fileCount.push(file);
        });
        printer.fileList.folders?.forEach((file) => {
          folderCount.push(file);
        });
      }
    });

    const uniqueDevices = _.uniqBy(devices, "printerURL");
    uniqueDevices.forEach((device) => {
      storageFree.push(device.storage.free);
      storageTotal.push(device.storage.total);
    });

    const storageFreeTotal = storageFree.reduce((a, b) => a + b, 0);
    const storageTotalTotal = storageTotal.reduce((a, b) => a + b, 0);
    this.#fileStatistics.storageUsed = storageTotalTotal - storageFreeTotal;
    this.#fileStatistics.storageTotal = storageTotalTotal;
    this.#fileStatistics.storageRemain = storageFreeTotal;
    this.#fileStatistics.storagePercent =
      storageTotalTotal === 0
        ? 0
        : Math.floor((this.#fileStatistics.storageUsed / storageTotalTotal) * 100);
    this.#fileStatistics.fileCount = fileCount.length;
    this.#fileStatistics.folderCount = folderCount.length;
    // TODO repeated calls?
    if (fileSizes.length !== 0) {
      this.#fileStatistics.biggestFile = Math.max(...fileSizes);
      this.#fileStatistics.smallestFile = Math.min(...fileSizes);
      this.#fileStatistics.averageFile = fileSizes.reduce((a, b) => a + b, 0) / fileCount.length;
    }
    if (fileLengths.length !== 0) {
      this.#fileStatistics.biggestLength = Math.max(...fileLengths);
      this.#fileStatistics.smallestLength = Math.min(...fileLengths);
      this.#fileStatistics.averageLength =
        fileLengths.reduce((a, b) => a + b, 0) / fileCount.length;
    }
  }
}

module.exports = FileCache;
