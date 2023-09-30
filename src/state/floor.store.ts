import { KeyDiffCache } from "@/utils/cache/key-diff.cache";
import { LoggerService } from "@/handlers/logger";
import { IFloorService } from "@/services/interfaces/floor.service.interface";
import { IdType } from "@/shared.constants";
import { IFloor } from "@/models/Floor";
import { Floor } from "@/entities";
import { ILoggerFactory } from "@/handlers/logger-factory";

interface CachedFloor {
  id: IdType;
  name: string;
  level: number;
  positions: Array<{
    x: number;
    y: number;
    printerId: IdType;
  }>;
}

/**
 * A generic cache for printer groups
 */
export class FloorStore extends KeyDiffCache<CachedFloor> {
  floorService: IFloorService;
  #logger: LoggerService;

  constructor({ floorService, loggerFactory }: { floorService: IFloorService; loggerFactory: ILoggerFactory }) {
    super();
    this.floorService = floorService;
    this.#logger = loggerFactory(FloorStore.name);
  }

  async loadStore() {
    const floors = await this.floorService.list();

    if (!floors?.length) {
      this.#logger.log("Creating default floor as non existed");
      const floor = await this.floorService.createDefaultFloor();
      await this.setKeyValue(floor.id, floor, true);
      return;
    }

    const keyValues = floors.map((floor) => ({
      key: floor.id.toString(),
      value: floor,
    }));
    await this.setKeyValuesBatch(keyValues, true);
  }

  async listCache() {
    const floors = await this.getAllValues();
    if (floors?.length) {
      return floors;
    }

    await this.loadStore();
    return await this.getAllValues();
  }

  async create(input: Partial<IFloor | Floor>) {
    const floor = await this.floorService.create(input);
    await this.setKeyValue(floor.id, floor, true);
    return floor;
  }

  async delete(floorId: IdType) {
    const deleteResult = await this.floorService.delete(floorId);
    await this.deleteKeyValue(floorId);
    return deleteResult;
  }

  async getFloor(floorId: IdType) {
    let floor = await this.getValue(floorId);
    if (!!floor) return floor;

    floor = await this.floorService.get(floorId);
    await this.setKeyValue(floorId, floor, true);
    return floor;
  }

  async update(floorId: IdType, input) {
    const floor = await this.floorService.update(floorId, input);
    await this.setKeyValue(floorId, floor, true);
    return floor;
  }

  async updateName(floorId: IdType, updateSpec) {
    const floor = await this.floorService.updateName(floorId, updateSpec);
    await this.setKeyValue(floorId, floor, true);
    return floor;
  }

  async updateFloorNumber(floorId: IdType, updateSpec) {
    const floor = await this.floorService.updateLevel(floorId, updateSpec);
    await this.setKeyValue(floorId, floor, true);
    return floor;
  }

  async addOrUpdatePrinter(floorId: IdType, printerInFloor) {
    const floor = await this.floorService.addOrUpdatePrinter(floorId, printerInFloor);
    await this.setKeyValue(floorId, floor, true);
    return floor;
  }

  async removePrinter(floorId: IdType, printerInFloor) {
    const floor = await this.floorService.removePrinter(floorId, printerInFloor);
    await this.deleteKeyValue(floorId);
    return floor;
  }

  async removePrinterFromAnyFloor(printerId: IdType) {
    await this.floorService.deletePrinterFromAnyFloor(printerId);

    // Bit harsh, but we need to reload the entire store
    await this.loadStore();
  }
}
