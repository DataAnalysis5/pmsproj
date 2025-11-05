const mongoose = require("mongoose")

const departmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    parentDepartment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null, // null means it's a main department
    },
    hods: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
)

// Add index for efficient queries
departmentSchema.index({ parentDepartment: 1 })
departmentSchema.index({ name: 1, parentDepartment: 1 }, { unique: true })

module.exports = mongoose.model("Department", departmentSchema)
