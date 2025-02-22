import { KeyDiffCache } from "@/utils/cache/key-diff.cache";
import { formatKB } from "@/utils/metric.utils";
import { printerEvents } from "@/constants/event.constants";
import { SettingsStore } from "@/state/settings.store";
import EventEmitter2 from "eventemitter2";
import { ILoggerFactory } from "@/handlers/logger-factory";
import { IdType } from "@/shared.constants";
import { LoggerService } from "@/handlers/logger";

export interface PrinterEventsCacheDto {
  current: any;
  history: any;
  timelapse: any;
  event: any;
  plugin: any;
}

export class PrinterEventsCache extends KeyDiffCache<PrinterEventsCacheDto> {
  logger: LoggerService;
  eventEmitter2: EventEmitter2;
  settingsStore: SettingsStore;

  constructor({
    eventEmitter2,
    loggerFactory,
    settingsStore,
  }: {
    eventEmitter2: EventEmitter2;
    loggerFactory: ILoggerFactory;
    settingsStore: SettingsStore;
  }) {
    super();
    this.settingsStore = settingsStore;
    this.logger = loggerFactory(PrinterEventsCache.name);
    this.eventEmitter2 = eventEmitter2;

    this.subscribeToEvents();
  }

  get _debugMode() {
    return this.settingsStore.getServerSettings().debugSettings?.debugSocketMessages;
  }

  async getPrinterSocketEvents(id: IdType) {
    return this.keyValueStore[id];
  }

  async getOrCreateEvents(printerId: IdType) {
    let ref = await this.getValue(printerId);
    if (!ref) {
      ref = { current: null, history: null, timelapse: null, event: {}, plugin: {} };
      await this.setKeyValue(printerId, ref);
    }
    return ref;
  }

  async setEvent(printerId: IdType, label: string, eventName: string, payload) {
    const ref = await this.getOrCreateEvents(printerId);
    ref[label] = {
      payload,
      receivedAt: Date.now(),
    };
    await this.setKeyValue(printerId, ref);
  }

  async setSubEvent(printerId: IdType, label: string, eventName: string, payload) {
    const ref = await this.getOrCreateEvents(printerId);
    ref[label][eventName] = {
      payload,
      receivedAt: Date.now(),
    };
    await this.setKeyValue(printerId, ref);
  }

  async handlePrintersDeleted({ printerIds }: { printerIds: IdType[] }) {
    await this.deleteKeysBatch(printerIds);
  }

  private subscribeToEvents() {
    this.eventEmitter2.on("octoprint.*", (e) => this.onPrinterSocketMessage(e));
    this.eventEmitter2.on(printerEvents.printersDeleted, this.handlePrintersDeleted.bind(this));
  }

  /**
   * @param {OctoPrintEventDto} e
   */
  private async onPrinterSocketMessage(e) {
    const printerId = e.printerId;
    if (e.event !== "plugin" && e.event !== "event") {
      await this.setEvent(printerId, e.event, null, e.event === "history" ? this.pruneHistoryPayload(e.payload) : e.payload);
      if (this._debugMode) {
        this.logger.log(`Message '${e.event}' received, size ${formatKB(e.payload)}`, e.printerId);
      }
    } else if (e.event === "plugin") {
      await this.setSubEvent(printerId, "plugin", e.payload.plugin, e.payload);
    } else if (e.event === "event") {
      const eventType = e.payload.type;
      await this.setSubEvent(printerId, "event", eventType, e.payload.payload);
      if (this._debugMode) {
        this.logger.log(`Event '${eventType}' received`, e.printerId);
      }
    } else {
      this.logger.log(`Message '${e.event}' received`, e.printerId);
    }
  }

  private pruneHistoryPayload(payload) {
    delete payload.logs;
    delete payload.temps;
    delete payload.messages;
    return payload;
  }
}
