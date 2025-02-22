import { captureException } from "@sentry/node";
import { errorSummary } from "@/utils/error.utils";
import { printerEvents } from "@/constants/event.constants";
import EventEmitter2 from "eventemitter2";
import { SocketFactory } from "@/services/octoprint/socket.factory";
import { PrinterCache } from "@/state/printer.cache";
import { OctoPrintSockIoAdapter } from "@/services/octoprint/octoprint-sockio.adapter";
import { LoggerService } from "@/handlers/logger";
import { ConfigService } from "@/services/core/config.service";
import { SettingsStore } from "@/state/settings.store";
import { SocketIoGateway } from "@/state/socket-io.gateway";
import { ILoggerFactory } from "@/handlers/logger-factory";
import { IdType } from "@/shared.constants";

export class PrinterSocketStore {
  socketIoGateway: SocketIoGateway;
  socketFactory: SocketFactory;
  eventEmitter2: EventEmitter2;
  printerCache: PrinterCache;
  printerSocketAdaptersById: Record<string, OctoPrintSockIoAdapter> = {};
  logger: LoggerService;
  configService: ConfigService;
  settingsStore: SettingsStore;

  constructor({
    socketFactory,
    socketIoGateway,
    settingsStore,
    eventEmitter2,
    printerCache,
    loggerFactory,
    configService,
  }: {
    socketFactory: SocketFactory;
    socketIoGateway: SocketIoGateway;
    settingsStore: SettingsStore;
    eventEmitter2: EventEmitter2;
    printerCache: PrinterCache;
    loggerFactory: ILoggerFactory;
    configService: ConfigService;
  }) {
    this.printerCache = printerCache;
    this.socketIoGateway = socketIoGateway;
    this.socketFactory = socketFactory;
    this.eventEmitter2 = eventEmitter2;
    this.settingsStore = settingsStore;
    this.logger = loggerFactory(PrinterSocketStore.name);
    this.configService = configService;

    this.subscribeToEvents();
  }

  getSocketStatesById() {
    const socketStatesById = {};
    Object.values(this.printerSocketAdaptersById).forEach((s) => {
      socketStatesById[s.printerId] = {
        printerId: s.printerId,
        socket: s.socketState,
        api: s.apiState,
      };
    });
    return socketStatesById;
  }

  /**
   * Load all printers into cache, and create a new socket for each printer (if enabled)
   * @param {OctoPrintEventDto} e
   */
  async loadPrinterSockets() {
    await this.printerCache.loadCache();

    const printerDocs = await this.printerCache.listCachedPrinters(false);
    this.printerSocketAdaptersById = {};
    /**
     * @type {Printer}
     */
    for (const doc of printerDocs) {
      try {
        await this.handlePrinterCreated({ printer: doc });
      } catch (e) {
        this.logger.error("PrinterSocketStore failed to construct new OctoPrint socket.", errorSummary(e));
      }
    }

    this.logger.log(`Loaded ${Object.keys(this.printerSocketAdaptersById).length} printer OctoPrint sockets`);
  }

  listPrinterSockets() {
    return Object.values(this.printerSocketAdaptersById);
  }

  /**
   * Reconnect the OctoPrint Websocket connection
   */
  reconnectOctoPrint(id: IdType) {
    const socket = this.getPrinterSocket(id);
    socket.close();

    // The reconnect task will pick up this state and reconnect
    socket.resetSocketState();
  }

  getPrinterSocket(id: IdType): OctoPrintSockIoAdapter {
    return this.printerSocketAdaptersById[id];
  }

  /**
   * Sets up the new WebSocket connections for all printers
   */
  async reconnectPrinterSockets(): Promise<void> {
    let reauthRequested = 0;
    let socketSetupRequested = 0;
    const socketStates = {};
    const apiStates = {};
    const promisesReauth = [];
    const failedSocketsReauth = [];
    for (const socket of Object.values(this.printerSocketAdaptersById)) {
      try {
        if (socket.needsReauth()) {
          reauthRequested++;
          const promise = socket.reauthSession().catch((_) => {
            failedSocketsReauth.push(socket.printerId);
          });
          promisesReauth.push(promise);
        }
      } catch (e) {
        if (this.settingsStore.getServerSettings().debugSettings?.debugSocketSetup) {
          this.logger.log("Failed to reauth printer socket", errorSummary(e));
        }
        captureException(e);
      }
    }

    await Promise.all(promisesReauth);

    const promisesOpenSocket = [];
    const failedSocketReopened = [];
    for (const socket of Object.values(this.printerSocketAdaptersById)) {
      try {
        if (socket.needsSetup() || socket.needsReopen()) {
          if (this.settingsStore.getServerSettings().debugSettings?.debugSocketSetup) {
            this.logger.log(
              `Reopening socket for printerId '${
                socket.printerId
              }' (setup: ${socket.needsSetup()}, reopen: ${socket.needsReopen()})`
            );
          }
          socketSetupRequested++;
          const promise = socket
            .setupSocketSession()
            .then(() => {
              socket.open();
            })
            .catch((_) => {
              failedSocketReopened.push(socket.printerId);
            });
          promisesOpenSocket.push(promise);
        }
      } catch (e) {
        if (this.settingsStore.getServerSettings().debugSettings?.debugSocketSetup) {
          this.logger.log(`Failed to setup printer socket ${errorSummary(e)}`);
        }
        captureException(e);
      }

      const keySocket = socket.socketState;
      const valSocket = socketStates[keySocket];
      socketStates[keySocket] = valSocket ? valSocket + 1 : 1;
      const keyApi = socket.apiState;
      const valApi = apiStates[keyApi];
      apiStates[keyApi] = valApi ? valApi + 1 : 1;
    }

    await Promise.all(promisesOpenSocket);

    return {
      reauth: reauthRequested,
      failedSocketReopened,
      failedSocketsReauth,
      socketSetup: socketSetupRequested,
      socket: socketStates,
      api: apiStates,
    };
  }

  private handleBatchPrinterCreated({ printers }) {
    for (const p of printers) {
      this.handlePrinterCreated({ printer: p });
    }
  }

  /**
   * @private
   * @param { printer: Printer } printer
   * @returns void
   */
  private handlePrinterCreated({ printer }) {
    this.createOrUpdateSocket(printer);
  }

  /**
   * @private
   * @param { printer: Printer } printer
   * @returns void
   */
  private handlePrinterUpdated({ printer }) {
    this.logger.log(`Printer '${printer.id}' updated. Updating socket.`);
    this.createOrUpdateSocket(printer);
  }

  /**
   * @param { printer: Printer } printer
   * @returns void
   */
  createOrUpdateSocket(printer) {
    const { enabled, id } = printer;
    let foundAdapter = this.printerSocketAdaptersById[id.toString()];

    // Delete the socket if the printer is disabled
    if (!enabled) {
      this.logger.log(`Printer '${id}' is disabled. Deleting socket.`);
      this.deleteSocket(id);
      return;
    }

    // Create a new socket if it doesn't exist
    if (!foundAdapter) {
      foundAdapter = this.socketFactory.createInstance();
      this.printerSocketAdaptersById[id] = foundAdapter;
    } else {
      foundAdapter.close();
      this.logger.log(`Closing printer '${id}' socket for update.`);
    }

    // Reset the socket credentials before (re-)connecting
    foundAdapter.registerCredentials({
      printerId: printer.id.toString(),
      loginDto: {
        apiKey: printer.apiKey,
        printerURL: printer.printerURL,
      },
      protocol: "ws",
    });
    foundAdapter.resetSocketState();
  }

  private handlePrintersDeleted({ printerIds }) {
    printerIds.forEach((id) => {
      this.deleteSocket(id);
    });
  }

  private subscribeToEvents() {
    this.eventEmitter2.on(printerEvents.printerCreated, this.handlePrinterCreated.bind(this));
    this.eventEmitter2.on(printerEvents.printersDeleted, this.handlePrintersDeleted.bind(this));
    this.eventEmitter2.on(printerEvents.printerUpdated, this.handlePrinterUpdated.bind(this));
    this.eventEmitter2.on(printerEvents.batchPrinterCreated, this.handleBatchPrinterCreated.bind(this));
  }

  private deleteSocket(printerId: string) {
    const socket = this.printerSocketAdaptersById[printerId];
    if (!!socket) {
      socket.close();
    }
    // TODO mark diff cache
    delete this.printerSocketAdaptersById[printerId];
  }
}
