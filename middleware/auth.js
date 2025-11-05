const User = require("../models/User")

// Check if user is authenticated
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/auth/login")
  }
  next()
}

// Check if user has specific role
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect("/auth/login")
    }

    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render("error", {
        message: "Access denied. Insufficient permissions.",
      })
    }

    next()
  }
}

// Check if HOD can access specific department
const requireDepartmentAccess = async (req, res, next) => {
  try {
    if (req.session.user.role === "admin") {
      return next() // Admin can access all departments
    }

    if (req.session.user.role === "hod") {
      const user = await User.findById(req.session.user._id).populate("department")
      if (!user || !user.department) {
        return res.status(403).render("error", {
          message: "No department assigned.",
        })
      }

      // Store department info in request for later use
      req.userDepartment = user.department
      return next()
    }

    next()
  } catch (error) {
    console.error("Department access check error:", error)
    res.status(500).render("error", { message: "Server error" })
  }
}

module.exports = {
  requireAuth,
  requireRole,
  requireDepartmentAccess,
}
