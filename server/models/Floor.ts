import { model, Schema } from "mongoose";
import { PrinterInFloorSchema } from "./FloorPrinter";

const FloorSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  floor: {
    type: Number,
    unique: true,
    min: [0, "Floors must be numbered from 0 and up"],
    required: true,
  },
  printers: [PrinterInFloorSchema],
});

export const Floor = model("Floor", FloorSchema);
