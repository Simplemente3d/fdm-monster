import { connect } from "../db-handler";
import { configureContainer } from "@/container";
import { Printer } from "@/models";
import { DITokens } from "@/container.tokens";
import { testPrinterData } from "./test-data/printer.data";
import { AwilixContainer } from "awilix";
import { PrinterService } from "@/services/printer.service";

let container: AwilixContainer;
let printerService: PrinterService;

beforeAll(async () => {
  await connect();
  container = configureContainer();
  printerService = container.resolve(DITokens.printerService);
});

afterAll(async () => {
  return Printer.deleteMany({});
});

describe("PrinterService", () => {
  it("Must be able to rename a created printer", async () => {
    const printer = await printerService.create(testPrinterData);
    const updatedName = "newName";
    const printerUpdate = {
      ...testPrinterData,
      name: updatedName,
    };

    await printerService.update(printer.id, printerUpdate);
    const foundPrinter = await Printer.findOne({ id: printer.id });
    expect(foundPrinter).toBeDefined();
    expect(foundPrinter!.name).toEqual(updatedName);
  });
});
