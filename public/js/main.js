// Main JavaScript file for PMS System

document.addEventListener("DOMContentLoaded", () => {
  // Initialize tooltips and other interactive elements
  initializeInteractiveElements()

  // Handle form submissions
  handleFormSubmissions()

  // Initialize charts if needed
  initializeCharts()
})

function initializeInteractiveElements() {
  // Add hover effects to cards only
  const cards = document.querySelectorAll(".stat-card, .dashboard-card, .admin-card")
  cards.forEach((card) => {
    card.addEventListener("mouseenter", function () {
      this.style.transform = "translateY(-2px)"
    })

    card.addEventListener("mouseleave", function () {
      this.style.transform = "translateY(0)"
    })
  })
}

function handleFormSubmissions() {
  // Handle review form submission
  const reviewForm = document.getElementById("reviewForm")
  if (reviewForm) {
    reviewForm.addEventListener("submit", async function (e) {
      e.preventDefault()

      const formData = new FormData(this)
      const data = Object.fromEntries(formData)

      // Validate form data
      if (!data.employee || !data.score || !data.comments.trim()) {
        showAlert("Please fill in all required fields", "error")
        return
      }

      if (data.comments.trim().length < 10) {
        showAlert("Comments must be at least 10 characters long", "error")
        return
      }

      try {
        const response = await fetch("/hod/reviews", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        })

        const result = await response.json()

        if (result.success) {
          showAlert("Review submitted successfully!", "success")
          setTimeout(() => {
            location.reload()
          }, 1500)
        } else {
          showAlert("Error: " + result.message, "error")
        }
      } catch (error) {
        console.error("Error submitting review:", error)
        showAlert("Error submitting review. Please try again.", "error")
      }
    })
  }
}

function initializeCharts() {
  // Initialize performance trend charts
  const trendCharts = document.querySelectorAll(".performance-chart")
  trendCharts.forEach((chart) => {
    animateScoreBars(chart)
  })
}

function animateScoreBars(container) {
  const scoreFills = container.querySelectorAll(".score-fill")
  scoreFills.forEach((fill, index) => {
    setTimeout(() => {
      fill.style.width = fill.style.width || "0%"
    }, index * 200)
  })
}

function showAlert(message, type = "info") {
  // Remove existing alerts
  const existingAlerts = document.querySelectorAll(".alert")
  existingAlerts.forEach((alert) => alert.remove())

  // Create new alert
  const alert = document.createElement("div")
  alert.className = `alert alert-${type}`
  alert.innerHTML = message

  // Insert at the top of main content
  const mainContent = document.querySelector(".main-content")
  if (mainContent) {
    mainContent.insertBefore(alert, mainContent.firstChild)

    // Auto-remove after 5 seconds
    setTimeout(() => {
      alert.remove()
    }, 5000)

    // Scroll to top to show alert
    window.scrollTo({ top: 0, behavior: "smooth" })
  }
}

// Utility functions
function formatDate(dateString) {
  const date = new Date(dateString)
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

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

// Export functions for use in other scripts
window.PMS = {
  showAlert,
  formatDate,
  getCurrentQuarter,
}
