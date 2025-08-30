const mongoose = require("mongoose")

const questionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null, // null means global question for all departments
    },
    category: {
      type: String,
      required: true,
      enum: ["performance", "quiz", "attendance", "late_remark", "behaviour", "extra"],
      default: "performance",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
)

module.exports = mongoose.model("Question", questionSchema)
