const { InternalServerException } = require("../exceptions/runtime.exceptions");
const { printerFileCleanSettingKey, serverSettingKey } = require("../constants/server-settings.constants");

class SettingsStore {
  #settings;
  #settingsService;

  constructor({ settingsService }) {
    this.#settingsService = settingsService;
  }

  async loadSettings() {
    // Setup Settings as connection is established
    this.#settings = await this.#settingsService.getOrCreate();
  }

  isRegistrationEnabled() {
    if (!this.#settings) throw new InternalServerException("Could not check server settings (server settings not loaded");
    return this.#settings[serverSettingKey].registration;
  }

  getSettings() {
    return Object.freeze({
      ...this.#settings._doc,
    });
  }

  getServerSettings() {
    return this.getSettings()[serverSettingKey];
  }

  /**
   * Cross-cutting concern for file clean operation
   * @returns {*}
   */
  getPrinterFileCleanSettings() {
    return this.getSettings()[printerFileCleanSettingKey];
  }

  isPreUploadFileCleanEnabled() {
    return this.getSettings()[printerFileCleanSettingKey]?.autoRemoveOldFilesBeforeUpload;
  }

  async setRegistrationEnabled(enabled = true) {
    this.#settings = await this.#settingsService.setRegistrationEnabled(enabled);
    return this.getSettings();
  }

  async setLoginRequired(enabled = true) {
    this.#settings = await this.#settingsService.setLoginRequired(enabled);
    return this.getSettings();
  }

  async setWhitelist(enabled = true, ipAddresses) {
    this.#settings = await this.#settingsService.setWhitelist(enabled, ipAddresses);
    return this.getSettings();
  }

  async updateSettings(fullUpdate) {
    this.#settings = await this.#settingsService.update(fullUpdate);
    return this.getSettings();
  }

  async updateFrontendSettings(frontendSettings) {
    this.#settings = await this.#settingsService.updateFrontendSettings(frontendSettings);
    return this.getSettings();
  }
}

module.exports = SettingsStore;
