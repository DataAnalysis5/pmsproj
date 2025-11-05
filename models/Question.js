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
    // What this question is used for
    // review: used by HODs to rate employees
    // self: used by employees to self-assess (does not affect rating)
    assessmentType: {
      type: String,
      enum: ["review", "self"],
      default: "review",
      index: true,
    },
    // How to answer this question
    // rating: 1-6 scale (used for HOD review; allowed for self if needed)
    // mcq: single-choice options for self assessment
    // text: free-text response for self assessment
    inputType: {
      type: String,
      enum: ["rating", "mcq", "text"],
      default: "rating",
    },
    // Options for MCQ type (ignored for other types)
    options: {
      type: [String],
      default: [],
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
