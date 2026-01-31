const express = require("express")
const bcrypt = require("bcryptjs")
const { body, validationResult } = require("express-validator")
const User = require("../models/User")

const router = express.Router()

// Login page
router.get("/login", (req, res) => {
  res.render("login", { error: null })
})

// Login POST - Updated to use Employee ID
router.post(
  "/login",
  [
    body("employeeId").trim().notEmpty().withMessage("Employee ID is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req)
      if (!errors.isEmpty()) {
        return res.render("login", { error: "Invalid Employee ID or password" })
      }

      const { employeeId, password } = req.body

      console.log("Login attempt for Employee ID:", employeeId) // Debug log

      const user = await User.findOne({ employeeId, isActive: true }).populate("department")

      if (!user) {
        console.log("User not found for Employee ID:", employeeId) // Debug log
        return res.render("login", { error: "Invalid Employee ID or password" })
      }

      console.log("User found:", user.name, "Role:", user.role) // Debug log

      const isMatch = await bcrypt.compare(password, user.password)
      console.log("Password match:", isMatch) // Debug log

      if (!isMatch) {
        console.log("Password mismatch for user:", employeeId) // Debug log
        return res.render("login", { error: "Invalid Employee ID or password" })
      }

      // Store user in session
      req.session.user = {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId,
        department: user.department,
        hodLevel: user.hodLevel,
      }

      console.log("Login successful for:", user.name) // Debug log

      // Redirect based on role
      switch (user.role) {
        case "admin":
          res.redirect("/admin/dashboard")
          break
        case "hod":
          res.redirect("/hod/dashboard")
          break
        case "employee":
          res.redirect("/employee/dashboard")
          break
        default:
          res.redirect("/")
      }
    } catch (error) {
      console.error("Login error:", error)
      res.render("login", { error: "Server error. Please try again." })
    }
  },
)

// Logout
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err)
    }
    res.redirect("/")
  })
})

module.exports = router
