const express = require("express")
const bcrypt = require("bcryptjs")
const { body, validationResult } = require("express-validator")
const { requireAuth, requireRole } = require("../middleware/auth")
const User = require("../models/User")
const Department = require("../models/Department")
const Review = require("../models/Review")
const Question = require("../models/Question")

const router = express.Router()

// Apply admin role requirement to all routes
router.use(requireAuth, requireRole(["admin"]))

// Export CSV - All Reviews
router.get("/export/reviews", async (req, res) => {
  try {
    const { quarter, department } = req.query

    // Build query
    const query = {}
    if (quarter) query.quarter = quarter
    if (department) query.department = department

    // Get reviews with populated data
    const reviews = await Review.find(query)
      .populate("employee", "name employeeId email")
      .populate("reviewer", "name employeeId")
      .populate("department", "name")
      .populate("answers.question", "text category")
      .sort({ createdAt: -1 })

    // Generate CSV content
    let csvContent = "Employee Name,Employee ID,Email,Department,Quarter,Overall Score,Reviewer,Review Date,Comments\n"

    reviews.forEach((review) => {
      const employeeName = review.employee ? review.employee.name : "Unknown"
      const employeeId = review.employee ? review.employee.employeeId : "Unknown"
      const email = review.employee ? review.employee.email : "Unknown"
      const department = review.department ? review.department.name : "Unknown"
      const score = review.overallScore || review.score || "N/A"
      const reviewer = review.reviewer ? review.reviewer.name : "Unknown"
      const reviewDate = new Date(review.reviewDate).toLocaleDateString()
      const comments = review.comments ? review.comments.replace(/"/g, '""').replace(/\n/g, " ") : ""

      csvContent += `"${employeeName}","${employeeId}","${email}","${department}","${review.quarter}","${score}","${reviewer}","${reviewDate}","${comments}"\n`
    })

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="reviews_export_${new Date().toISOString().split("T")[0]}.csv"`,
    )
    res.send(csvContent)
  } catch (error) {
    console.error("Export reviews error:", error)
    res.status(500).render("error", { message: "Error exporting reviews" })
  }
})

// Export CSV - Employee Performance Summary
router.get("/export/performance", async (req, res) => {
  try {
    const { quarter } = req.query
    const currentQuarter = quarter || getCurrentQuarter()

    // Get all employees with their latest reviews
    const employees = await User.find({
      role: { $in: ["employee", "hod"] },
      isActive: true,
    }).populate("department", "name")

    // Get reviews for the specified quarter
    const reviews = await Review.find({ quarter: currentQuarter })
      .populate("employee", "name employeeId email")
      .populate("department", "name")

    // Create performance summary
    const performanceData = []

    for (const employee of employees) {
      const employeeReviews = reviews.filter((r) => r.employee && r.employee._id.toString() === employee._id.toString())

      let avgScore = 0
      const reviewCount = employeeReviews.length

      if (reviewCount > 0) {
        const totalScore = employeeReviews.reduce((sum, review) => {
          return sum + (review.overallScore || review.score || 0)
        }, 0)
        avgScore = (totalScore / reviewCount).toFixed(2)
      }

      const performanceLevel = getPerformanceLevel(Number.parseFloat(avgScore))

      performanceData.push({
        name: employee.name,
        employeeId: employee.employeeId,
        email: employee.email,
        department: employee.department ? employee.department.name : "Not Assigned",
        role: employee.role.toUpperCase(),
        avgScore: avgScore || "N/A",
        reviewCount,
        performanceLevel,
        quarter: currentQuarter,
      })
    }

    // Generate CSV content
    let csvContent =
      "Employee Name,Employee ID,Email,Department,Role,Average Score,Review Count,Performance Level,Quarter\n"

    performanceData.forEach((emp) => {
      csvContent += `"${emp.name}","${emp.employeeId}","${emp.email}","${emp.department}","${emp.role}","${emp.avgScore}","${emp.reviewCount}","${emp.performanceLevel}","${emp.quarter}"\n`
    })

    // Set headers for CSV download
    res.setHeader("Content-Type", "text/csv")
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="performance_summary_${currentQuarter.replace(" ", "_")}_${new Date().toISOString().split("T")[0]}.csv"`,
    )
    res.send(csvContent)
  } catch (error) {
    console.error("Export performance error:", error)
    res.status(500).render("error", { message: "Error exporting performance data" })
  }
})

// Admin Dashboard
router.get("/dashboard", async (req, res) => {
  try {
    console.log("Loading admin dashboard...") // Debug log

    // Get dashboard statistics (exclude self-assessments from review counts/averages)
    const totalEmployees = await User.countDocuments({ role: "employee", isActive: true })
    const totalHODs = await User.countDocuments({ role: "hod", isActive: true })
    const totalDepartments = await Department.countDocuments({ isActive: true })

    // Check if Question model exists, if not set to 0
    let totalQuestions = 0
    try {
      totalQuestions = await Question.countDocuments({ isActive: true })
    } catch (questionError) {
      console.log("Question model not found, setting totalQuestions to 0")
      totalQuestions = 0
    }

    // Current quarter reviews (exclude self assessments)
    const currentQuarter = getCurrentQuarter()
    const currentQuarterReviews = await Review.countDocuments({
      quarter: currentQuarter,
      isSelfAssessment: { $ne: true },
    })

    // Average rating for current quarter (6-point scale, exclude self assessments)
    let avgRating = 0
    try {
      const avgRatingResult = await getAverageRatings(currentQuarter)
      avgRating = avgRatingResult.length > 0 ? avgRatingResult[0].avgRating.toFixed(2) : 0
    } catch (avgError) {
      console.log("Error calculating average rating:", avgError.message)
      avgRating = 0
    }

    // Department-wise statistics (exclude self assessments)
    let departmentStats = []
    try {
      departmentStats = await getDepartmentStats(currentQuarter)
    } catch (deptError) {
      console.log("Error getting department stats:", deptError.message)
      departmentStats = []
    }

    // Quarterly trends (last 4 quarters, exclude self assessments)
    let quarterlyTrends = []
    try {
      quarterlyTrends = await getQuarterlyTrends()
    } catch (trendError) {
      console.log("Error getting quarterly trends:", trendError.message)
      quarterlyTrends = []
    }

    console.log("Dashboard data loaded successfully") // Debug log

    res.render("admin/dashboard", {
      totalEmployees,
      totalHODs,
      totalDepartments,
      totalQuestions,
      currentQuarterReviews,
      avgRating,
      departmentStats,
      quarterlyTrends,
      currentQuarter,
    })
  } catch (error) {
    console.error("Admin dashboard error:", error)
    res.status(500).render("error", {
      message: "Error loading dashboard: " + error.message,
      user: req.session.user || null,
    })
  }
})

// Questions Management
router.get("/questions", async (req, res) => {
  try {
    const questions = await Question.find({ isActive: true })
      .populate("department", "name parentDepartment")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
    const departments = await Department.find({ isActive: true })
    res.render("admin/questions", { questions, departments })
  } catch (error) {
    console.error("Questions error:", error)
    res.status(500).render("error", { message: "Error loading questions" })
  }
})

// Add Question - supports self-assessment MCQ/Text (and rating if needed)
router.post(
  "/questions",
  [
    body("text").trim().notEmpty().withMessage("Question text is required"),
    body("category")
      .isIn(["performance", "quiz", "attendance", "late_remark", "behaviour", "extra"])
      .withMessage("Valid category is required"),
    body("assessmentType").isIn(["review", "self"]).withMessage("Valid assessment type is required"),
    body("inputType").isIn(["rating", "mcq", "text"]).withMessage("Valid input type is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        const questions = await Question.find({ isActive: true })
          .populate("department", "name parentDepartment")
          .populate("createdBy", "name")
          .sort({ createdAt: -1 })
        const departments = await Department.find({ isActive: true })
        return res.render("admin/questions", {
          questions,
          departments,
          error: errors.array()[0].msg,
        })
      }

      const { text, category, department, assessmentType, inputType, options } = req.body

      const questionData = {
        text,
        category,
        createdBy: req.session.user._id,
        isActive: true,
        assessmentType,
        inputType,
      }

      if (department && department.trim() !== "") {
        questionData.department = department
        console.log("Question assigned to department ID:", department)
      } else {
        console.log("Question created as global (no department assigned)")
      }

      if (inputType === "mcq") {
        // options can be newline or comma separated
        let opts = []
        if (Array.isArray(options)) {
          opts = options
        } else if (typeof options === "string") {
          // split by newline first, then commas as fallback
          const byLines = options
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
          if (byLines.length > 1) {
            opts = byLines
          } else {
            opts = options
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          }
        }
        questionData.options = opts
      }

      const newQuestion = await Question.create(questionData)
      console.log("Question created:", newQuestion.text, "type:", assessmentType, "/", inputType)

      res.redirect("/admin/questions")
    } catch (error) {
      console.error("Add question error:", error)
      const questions = await Question.find({ isActive: true })
        .populate("department", "name parentDepartment")
        .populate("createdBy", "name")
        .sort({ createdAt: -1 })
      const departments = await Department.find({ isActive: true })

      res.render("admin/questions", {
        questions,
        departments,
        error: "Error adding question",
      })
    }
  },
)

// Departments Management - Updated for sub-departments and multiple HODs
router.get("/departments", async (req, res) => {
  try {
    // Get all departments with their parent departments and HODs
    const departments = await Department.find({ isActive: true })
      .populate("parentDepartment", "name")
      .populate("hods", "name employeeId")
      .sort({ parentDepartment: 1, name: 1 })

    const hods = await User.find({ role: "hod", isActive: true })

    // Get main departments (no parent) for the parent dropdown
    const mainDepartments = await Department.find({
      isActive: true,
      parentDepartment: null,
    }).sort({ name: 1 })

    res.render("admin/departments", { departments, hods, mainDepartments })
  } catch (error) {
    console.error("Departments error:", error)
    res.status(500).render("error", { message: "Error loading departments" })
  }
})

// Add Department - Updated for sub-departments and multiple HODs
router.post(
  "/departments",
  [body("name").trim().notEmpty().withMessage("Department name is required"), body("description").trim().optional()],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        const departments = await Department.find({ isActive: true })
          .populate("parentDepartment", "name")
          .populate("hods", "name employeeId")
          .sort({ parentDepartment: 1, name: 1 })
        const hods = await User.find({ role: "hod", isActive: true })
        const mainDepartments = await Department.find({
          isActive: true,
          parentDepartment: null,
        }).sort({ name: 1 })
        return res.render("admin/departments", {
          departments,
          hods,
          mainDepartments,
          error: errors.array()[0].msg,
        })
      }

      const { name, description, parentDepartment, hods } = req.body

      const departmentData = {
        name,
        description: description || "",
        isActive: true,
      }

      // Handle parent department
      if (parentDepartment && parentDepartment.trim() !== "") {
        departmentData.parentDepartment = parentDepartment
      }

      // Handle multiple HODs
      if (hods) {
        if (Array.isArray(hods)) {
          departmentData.hods = hods.filter((hod) => hod.trim() !== "")
        } else if (hods.trim() !== "") {
          departmentData.hods = [hods]
        }
      }

      const newDepartment = await Department.create(departmentData)
      console.log("Department created:", newDepartment) // Debug log

      res.redirect("/admin/departments")
    } catch (error) {
      console.error("Add department error:", error)
      const departments = await Department.find({ isActive: true })
        .populate("parentDepartment", "name")
        .populate("hods", "name employeeId")
        .sort({ parentDepartment: 1, name: 1 })
      const hods = await User.find({ role: "hod", isActive: true })
      const mainDepartments = await Department.find({
        isActive: true,
        parentDepartment: null,
      }).sort({ name: 1 })

      let errorMessage = "Error adding department"
      if (error.code === 11000) {
        errorMessage = "Department name already exists in this parent department"
      }

      res.render("admin/departments", {
        departments,
        hods,
        mainDepartments,
        error: errorMessage,
      })
    }
  },
)

// Edit Department - GET - Updated for sub-departments and multiple HODs
router.get("/departments/:id/edit", async (req, res) => {
  try {
    const department = await Department.findById(req.params.id)
      .populate("parentDepartment", "name")
      .populate("hods", "name employeeId")
    if (!department) {
      return res.status(404).render("error", { message: "Department not found" })
    }

    const hods = await User.find({ role: "hod", isActive: true })
    const mainDepartments = await Department.find({
      isActive: true,
      parentDepartment: null,
      _id: { $ne: req.params.id }, // Exclude current department from parent options
    }).sort({ name: 1 })

    res.render("admin/edit-department", { department, hods, mainDepartments })
  } catch (error) {
    console.error("Edit department GET error:", error)
    res.status(500).render("error", { message: "Error loading department" })
  }
})

// Edit Department - POST - Updated for sub-departments and multiple HODs
router.post(
  "/departments/:id/edit",
  [body("name").trim().notEmpty().withMessage("Department name is required"), body("description").trim().optional()],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        const department = await Department.findById(req.params.id)
          .populate("parentDepartment", "name")
          .populate("hods", "name employeeId")
        const hods = await User.find({ role: "hod", isActive: true })
        const mainDepartments = await Department.find({
          isActive: true,
          parentDepartment: null,
          _id: { $ne: req.params.id },
        }).sort({ name: 1 })
        return res.render("admin/edit-department", {
          department,
          hods,
          mainDepartments,
          error: errors.array()[0].msg,
        })
      }

      const { name, description, parentDepartment, hods } = req.body

      const updateData = {
        name,
        description: description || "",
      }

      // Handle parent department
      if (parentDepartment && parentDepartment.trim() !== "") {
        updateData.parentDepartment = parentDepartment
      } else {
        updateData.parentDepartment = null
      }

      // Handle multiple HODs
      if (hods) {
        if (Array.isArray(hods)) {
          updateData.hods = hods.filter((hod) => hod.trim() !== "")
        } else if (hods.trim() !== "") {
          updateData.hods = [hods]
        } else {
          updateData.hods = []
        }
      } else {
        updateData.hods = []
      }

      await Department.findByIdAndUpdate(req.params.id, updateData)
      console.log("Department updated:", name) // Debug log

      res.redirect("/admin/departments")
    } catch (error) {
      console.error("Edit department POST error:", error)
      const department = await Department.findById(req.params.id)
        .populate("parentDepartment", "name")
        .populate("hods", "name employeeId")
      const hods = await User.find({ role: "hod", isActive: true })
      const mainDepartments = await Department.find({
        isActive: true,
        parentDepartment: null,
        _id: { $ne: req.params.id },
      }).sort({ name: 1 })

      let errorMessage = "Error updating department"
      if (error.code === 11000) {
        errorMessage = "Department name already exists in this parent department"
      }

      res.render("admin/edit-department", {
        department,
        hods,
        mainDepartments,
        error: errorMessage,
      })
    }
  },
)

// Employees Management
router.get("/employees", async (req, res) => {
  try {
    const employees = await User.find({
      role: { $in: ["employee", "hod"] },
      isActive: true,
    }).populate("department")
    const departments = await Department.find({ isActive: true })
      .populate("parentDepartment", "name")
      .sort({ parentDepartment: 1, name: 1 })
    res.render("admin/employees", { employees, departments })
  } catch (error) {
    console.error("Employees error:", error)
    res.status(500).render("error", { message: "Error loading employees" })
  }
})

// Add Employee - Enhanced debugging
router.post(
  "/employees",
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
    body("employeeId").trim().notEmpty().withMessage("Employee ID is required"),
    body("role").isIn(["employee", "hod"]).withMessage("Valid role is required"),
    body("department").notEmpty().withMessage("Department is required"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        const employees = await User.find({
          role: { $in: ["employee", "hod"] },
          isActive: true,
        }).populate("department")
        const departments = await Department.find({ isActive: true })
          .populate("parentDepartment", "name")
          .sort({ parentDepartment: 1, name: 1 })
        return res.render("admin/employees", {
          employees,
          departments,
          error: errors.array()[0].msg,
        })
      }

      const { name, email, employeeId, role, department, hodLevel, password } = req.body

      console.log("=== ADD EMPLOYEE DEBUG ===")
      console.log("Attempting to create employee with:")
      console.log("- Name:", name)
      console.log("- Email:", email)
      console.log("- Employee ID:", employeeId)
      console.log("- Role:", role)
      console.log("- Department:", department)

      // Check if employeeId already exists
      const existingEmployee = await User.findOne({ employeeId: employeeId })
      if (existingEmployee) {
        console.log("❌ Employee ID already exists:", existingEmployee.name, existingEmployee.employeeId)
        const employees = await User.find({
          role: { $in: ["employee", "hod"] },
          isActive: true,
        }).populate("department")
        const departments = await Department.find({ isActive: true })
          .populate("parentDepartment", "name")
          .sort({ parentDepartment: 1, name: 1 })
        return res.render("admin/employees", {
          employees,
          departments,
          error: "Employee ID already exists",
        })
      }

      console.log("✅ Employee ID is unique, proceeding with creation...")

      const hashedPassword = await bcrypt.hash(password, 12)

      const userData = {
        name,
        email,
        employeeId,
        role,
        department,
        password: hashedPassword,
        isActive: true,
      }

      if (role === "hod" && hodLevel) {
        userData.hodLevel = hodLevel
      }

      console.log("Creating user with data:", { ...userData, password: "[HIDDEN]" })

      const newUser = await User.create(userData)
      console.log("✅ Employee created successfully:", newUser.name, newUser.employeeId, newUser.role)

      res.redirect("/admin/employees")
    } catch (error) {
      console.error("❌ Add employee error:", error)
      console.log("Error code:", error.code)
      console.log("Error message:", error.message)
      console.log("Error keyPattern:", error.keyPattern)
      console.log("Error keyValue:", error.keyValue)

      const employees = await User.find({
        role: { $in: ["employee", "hod"] },
        isActive: true,
      }).populate("department")
      const departments = await Department.find({ isActive: true })
        .populate("parentDepartment", "name")
        .sort({ parentDepartment: 1, name: 1 })

      let errorMessage = "Error adding employee"
      if (error.code === 11000) {
        if (error.keyPattern && error.keyPattern.employeeId) {
          errorMessage = "Employee ID already exists"
        } else if (error.keyPattern && error.keyPattern.email) {
          errorMessage = "Email constraint error - please run the database fix script"
        } else {
          errorMessage = `Duplicate key error: ${JSON.stringify(error.keyPattern)}`
        }
      }

      res.render("admin/employees", {
        employees,
        departments,
        error: errorMessage,
      })
    }
  },
)

// Edit Employee - GET
router.get("/employees/:id/edit", async (req, res) => {
  try {
    const employee = await User.findById(req.params.id).populate("department")
    if (!employee) {
      return res.status(404).render("error", { message: "Employee not found" })
    }

    const departments = await Department.find({ isActive: true })
      .populate("parentDepartment", "name")
      .sort({ parentDepartment: 1, name: 1 })
    res.render("admin/edit-employee", { employee, departments })
  } catch (error) {
    console.error("Edit employee GET error:", error)
    res.status(500).render("error", { message: "Error loading employee" })
  }
})

// Edit Employee - POST - Enhanced debugging
router.post(
  "/employees/:id/edit",
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
    body("employeeId").trim().notEmpty().withMessage("Employee ID is required"),
    body("role").isIn(["employee", "hod"]).withMessage("Valid role is required"),
    body("department").notEmpty().withMessage("Department is required"),
    body("password").optional().isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        const employee = await User.findById(req.params.id).populate("department")
        const departments = await Department.find({ isActive: true })
          .populate("parentDepartment", "name")
          .sort({ parentDepartment: 1, name: 1 })
        return res.render("admin/edit-employee", {
          employee,
          departments,
          error: errors.array()[0].msg,
        })
      }

      const { name, email, employeeId, role, department, hodLevel, password } = req.body

      console.log("=== EDIT EMPLOYEE DEBUG ===")
      console.log("Attempting to update employee ID:", req.params.id)
      console.log("New data:")
      console.log("- Name:", name)
      console.log("- Email:", email)
      console.log("- Employee ID:", employeeId)
      console.log("- Role:", role)
      console.log("- Department:", department)

      // Check if employeeId already exists (excluding current user)
      const existingEmployee = await User.findOne({
        employeeId: employeeId,
        _id: { $ne: req.params.id },
      })
      if (existingEmployee) {
        console.log("❌ Employee ID already exists:", existingEmployee.name, existingEmployee.employeeId)
        const employee = await User.findById(req.params.id).populate("department")
        const departments = await Department.find({ isActive: true })
          .populate("parentDepartment", "name")
          .sort({ parentDepartment: 1, name: 1 })
        return res.render("admin/edit-employee", {
          employee,
          departments,
          error: "Employee ID already exists",
        })
      }

      console.log("✅ Employee ID is unique, proceeding with update...")

      const updateData = {
        name,
        email,
        employeeId,
        role,
        department,
      }

      if (role === "hod" && hodLevel) {
        updateData.hodLevel = hodLevel
      } else {
        updateData.hodLevel = null
      }

      // Only update password if provided
      if (password && password.trim() !== "") {
        updateData.password = await bcrypt.hash(password, 12)
      }

      console.log("Updating user with data:", {
        ...updateData,
        password: updateData.password ? "[HIDDEN]" : "Not updated",
      })

      await User.findByIdAndUpdate(req.params.id, updateData)
      console.log("✅ Employee updated successfully:", name, role)

      res.redirect("/admin/employees")
    } catch (error) {
      console.error("❌ Edit employee error:", error)
      console.log("Error code:", error.code)
      console.log("Error message:", error.message)
      console.log("Error keyPattern:", error.keyPattern)
      console.log("Error keyValue:", error.keyValue)

      const employee = await User.findById(req.params.id).populate("department")
      const departments = await Department.find({ isActive: true })
        .populate("parentDepartment", "name")
        .sort({ parentDepartment: 1, name: 1 })

      let errorMessage = "Error updating employee"
      if (error.code === 11000) {
        if (error.keyPattern && error.keyPattern.employeeId) {
          errorMessage = "Employee ID already exists"
        } else if (error.keyPattern && error.keyPattern.email) {
          errorMessage = "Email constraint error - please run the database fix script"
        } else {
          errorMessage = `Duplicate key error: ${JSON.stringify(error.keyPattern)}`
        }
      }

      res.render("admin/edit-employee", {
        employee,
        departments,
        error: errorMessage,
      })
    }
  },
)

// Helper function to get current quarter
function getCurrentQuarter() {
  const month = new Date().getMonth() + 1
  const year = new Date().getFullYear()
  let quarter

  if (month <= 3) quarter = "Q1"
  else if (month <= 6) quarter = "Q2"
  else if (month <= 9) quarter = "Q3"
  else quarter = "Q4"

  return `${quarter} ${year}`
}

// Helper function to get average ratings (aggregated by employee) - Excludes self assessments
async function getAverageRatings(quarter) {
  try {
    return await Review.aggregate([
      { $match: { quarter, isSelfAssessment: { $ne: true } } },
      {
        $addFields: {
          effectiveScore: {
            $cond: {
              if: { $gt: ["$overallScore", 0] },
              then: "$overallScore",
              else: { $ifNull: ["$score", 0] },
            },
          },
        },
      },
      {
        $group: {
          _id: "$employee",
          avgScore: { $avg: "$effectiveScore" },
        },
      },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$avgScore" },
        },
      },
    ])
  } catch (error) {
    console.log("Error in getAverageRatings:", error.message)
    return []
  }
}

// Helper function to get department statistics (Excludes self assessments)
async function getDepartmentStats(quarter) {
  try {
    return await Review.aggregate([
      { $match: { quarter, isSelfAssessment: { $ne: true } } },
      {
        $addFields: {
          effectiveScore: {
            $cond: {
              if: { $gt: ["$overallScore", 0] },
              then: "$overallScore",
              else: { $ifNull: ["$score", 0] },
            },
          },
        },
      },
      {
        $group: {
          _id: { employee: "$employee", department: "$department" },
          avgScore: { $avg: "$effectiveScore" },
        },
      },
      {
        $lookup: {
          from: "departments",
          localField: "_id.department",
          foreignField: "_id",
          as: "dept",
        },
      },
      { $unwind: "$dept" },
      {
        $group: {
          _id: "$dept.name",
          avgRating: { $avg: "$avgScore" },
          reviewCount: { $sum: 1 },
        },
      },
      { $sort: { avgRating: -1 } },
    ])
  } catch (error) {
    console.log("Error in getDepartmentStats:", error.message)
    return []
  }
}

// Helper function to get quarterly trends (Excludes self assessments)
async function getQuarterlyTrends() {
  try {
    const trends = []
    const currentDate = new Date()

    for (let i = 3; i >= 0; i--) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i * 3, 1)
      const month = date.getMonth() + 1
      const year = date.getFullYear()

      let quarter
      if (month <= 3) quarter = "Q1"
      else if (month <= 6) quarter = "Q2"
      else if (month <= 9) quarter = "Q3"
      else quarter = "Q4"

      const quarterStr = `${quarter} ${year}`

      try {
        const avgResult = await getAverageRatings(quarterStr)
        const reviewCount = await Review.countDocuments({ quarter: quarterStr, isSelfAssessment: { $ne: true } })

        trends.push({
          quarter: quarterStr,
          avgRating: avgResult.length > 0 ? avgResult[0].avgRating.toFixed(2) : 0,
          reviewCount: reviewCount,
        })
      } catch (quarterError) {
        console.log(`Error getting data for quarter ${quarterStr}:`, quarterError.message)
        trends.push({
          quarter: quarterStr,
          avgRating: 0,
          reviewCount: 0,
        })
      }
    }

    return trends
  } catch (error) {
    console.log("Error in getQuarterlyTrends:", error.message)
    return []
  }
}

// Helper function to get performance level
function getPerformanceLevel(score) {
  if (score >= 6) return "Outstanding Performance"
  if (score >= 5) return "Superior Performance"
  if (score >= 4) return "Effective Performance"
  if (score >= 3) return "Standard Performance"
  if (score >= 2) return "Developing Performance"
  return "Ineffective Performance"
}

module.exports = router
