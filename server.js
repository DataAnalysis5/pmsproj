const express = require("express")
const mongoose = require("mongoose")
const session = require("express-session")
const MongoStore = require("connect-mongo")
const path = require("path")
require("dotenv").config()

const app = express()

// Import routes
const authRoutes = require("./routes/auth")
const adminRoutes = require("./routes/admin")
const hodRoutes = require("./routes/hod")
const employeeRoutes = require("./routes/employee")
const apiRoutes = require("./routes/api")

// Database connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB")
    // Create default admin after DB connection
    createDefaultAdmin()
  })
  .catch((err) => console.error("MongoDB connection error:", err))

// Middleware
app.use(express.urlencoded({ extended: true }))
app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
    }),
    cookie: {
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }),
)

// View engine setup
app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))

// Make user available in all templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null
  res.locals.currentQuarter = getCurrentQuarter()
  next()
})

// Routes
app.use("/auth", authRoutes)
app.use("/admin", adminRoutes)
app.use("/hod", hodRoutes)
app.use("/employee", employeeRoutes)
app.use("/api", apiRoutes)

// Home route
app.get("/", (req, res) => {
  if (req.session.user) {
    switch (req.session.user.role) {
      case "admin":
        return res.redirect("/admin/dashboard")
      case "hod":
        return res.redirect("/hod/dashboard")
      case "employee":
        return res.redirect("/employee/dashboard")
    }
  }
  res.render("login", { error: null })
})

// Debug route to check admin user (remove in production)
app.get("/debug/admin", async (req, res) => {
  try {
    const User = require("./models/User")
    const admin = await User.findOne({ role: "admin" })
    if (admin) {
      res.json({
        exists: true,
        email: admin.email,
        name: admin.name,
        employeeId: admin.employeeId,
        isActive: admin.isActive,
      })
    } else {
      res.json({ exists: false, message: "No admin user found" })
    }
  } catch (error) {
    res.json({ error: error.message })
  }
})

// Debug route to check reviews
app.get("/debug/reviews", async (req, res) => {
  try {
    const Review = require("./models/Review")
    const reviews = await Review.find({})
      .populate("employee", "name employeeId")
      .populate("reviewer", "name employeeId")
      .sort({ createdAt: -1 })
      .limit(20)

    res.json({
      totalReviews: reviews.length,
      reviews: reviews.map((review) => ({
        id: review._id,
        employee: review.employee ? `${review.employee.name} (${review.employee.employeeId})` : "Unknown",
        reviewer: review.reviewer ? `${review.reviewer.name} (${review.reviewer.employeeId})` : "Unknown",
        quarter: review.quarter,
        score: review.overallScore || review.score,
        createdAt: review.createdAt,
      })),
    })
  } catch (error) {
    res.json({ error: error.message })
  }
})

// Helper function for current quarter
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

// Create default admin user
const User = require("./models/User")
const bcrypt = require("bcryptjs")

async function createDefaultAdmin() {
  try {
    console.log("Checking for admin user...")
    const adminExists = await User.findOne({ role: "admin" })

    if (!adminExists) {
      console.log("Creating default admin user...")
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || "admin123", 12)

      const adminUser = await User.create({
        name: "System Administrator",
        email: process.env.ADMIN_EMAIL || "admin@company.com",
        password: hashedPassword,
        role: "admin",
        employeeId: "ADMIN001",
        isActive: true,
      })

      console.log("Default admin user created successfully:")
      console.log("Email:", adminUser.email)
      console.log("Password: admin123")
    } else {
      console.log("Admin user already exists:")
      console.log("Email:", adminExists.email)
    }
  } catch (error) {
    console.error("Error creating default admin:", error)
  }
}

// Start server
// Start server
const PORT = process.env.PORT || 3000
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT} (bound to 0.0.0.0)`)
})


