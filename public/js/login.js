// Login page functionality
document.addEventListener("DOMContentLoaded", () => {
  // Initialize login page
  initializeLoginPage()

  // Add form validation
  setupFormValidation()

  // Add keyboard shortcuts
  setupKeyboardShortcuts()

  // Add loading states
  setupLoadingStates()
})

function initializeLoginPage() {
  // Add focus to employee ID input
  const employeeIdInput = document.getElementById("employeeId")
  if (employeeIdInput) {
    employeeIdInput.focus()
  }

  // Add input animations
  setupInputAnimations()

  // Check for saved credentials
  checkSavedCredentials()
}

function setupInputAnimations() {
  const inputs = document.querySelectorAll(".form-input")

  inputs.forEach((input) => {
    // Add floating label effect
    input.addEventListener("focus", function () {
      this.parentElement.classList.add("focused")
    })

    input.addEventListener("blur", function () {
      if (!this.value) {
        this.parentElement.classList.remove("focused")
      }
    })

    // Check if input has value on load
    if (input.value) {
      input.parentElement.classList.add("focused")
    }
  })
}

function setupFormValidation() {
  const form = document.getElementById("loginForm")
  const employeeIdInput = document.getElementById("employeeId")
  const passwordInput = document.getElementById("password")

  // Real-time validation
  employeeIdInput.addEventListener("input", function () {
    validateEmployeeId(this)
  })

  passwordInput.addEventListener("input", function () {
    validatePassword(this)
  })

  // Form submission
  form.addEventListener("submit", (e) => {
    if (!validateForm()) {
      e.preventDefault()
      showAlert("Please fix the errors before submitting.", "error")
    } else {
      showLoadingState()
    }
  })
}

function validateEmployeeId(input) {
  // Employee ID should be at least 3 characters and alphanumeric
  const employeeIdRegex = /^[A-Za-z0-9]{3,}$/
  const isValid = employeeIdRegex.test(input.value)

  toggleInputValidation(input, isValid)
  return isValid
}

function validatePassword(input) {
  const isValid = input.value.length >= 3 // Minimum 3 characters

  toggleInputValidation(input, isValid)
  return isValid
}

function toggleInputValidation(input, isValid) {
  const formGroup = input.parentElement

  if (input.value.length > 0) {
    if (isValid) {
      formGroup.classList.remove("error")
      formGroup.classList.add("valid")
    } else {
      formGroup.classList.remove("valid")
      formGroup.classList.add("error")
    }
  } else {
    formGroup.classList.remove("valid", "error")
  }
}

function validateForm() {
  const employeeIdInput = document.getElementById("employeeId")
  const passwordInput = document.getElementById("password")

  const isEmployeeIdValid = validateEmployeeId(employeeIdInput)
  const isPasswordValid = validatePassword(passwordInput)

  return isEmployeeIdValid && isPasswordValid
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Enter key to submit form
    if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
      const form = document.getElementById("loginForm")
      if (validateForm()) {
        form.submit()
      }
    }

    // Escape key to close modals
    if (e.key === "Escape") {
      closeAllModals()
    }
  })
}

function setupLoadingStates() {
  const form = document.getElementById("loginForm")

  form.addEventListener("submit", () => {
    showLoadingState()
  })
}

function showLoadingState() {
  const button = document.getElementById("loginButton")
  const btnText = button.querySelector(".btn-text")
  const btnLoader = button.querySelector(".btn-loader")

  button.disabled = true
  btnText.style.display = "none"
  btnLoader.style.display = "inline-flex"

  // Simulate minimum loading time for better UX
  setTimeout(() => {
    if (!window.location.href.includes("error")) {
      // If no error, keep loading state
      return
    }
    hideLoadingState()
  }, 1000)
}

function hideLoadingState() {
  const button = document.getElementById("loginButton")
  const btnText = button.querySelector(".btn-text")
  const btnLoader = button.querySelector(".btn-loader")

  button.disabled = false
  btnText.style.display = "inline"
  btnLoader.style.display = "none"
}

function togglePassword() {
  const passwordInput = document.getElementById("password")
  const toggleIcon = document.getElementById("passwordToggleIcon")

  if (passwordInput.type === "password") {
    passwordInput.type = "text"
    toggleIcon.className = "fas fa-eye-slash"
  } else {
    passwordInput.type = "password"
    toggleIcon.className = "fas fa-eye"
  }
}

function showAlert(message, type = "info") {
  // Remove existing alerts
  const existingAlerts = document.querySelectorAll(".alert:not(#errorAlert)")
  existingAlerts.forEach((alert) => alert.remove())

  // Create new alert
  const alert = document.createElement("div")
  alert.className = `alert alert-${type}`
  alert.innerHTML = `
        <i class="fas fa-${type === "error" ? "exclamation-circle" : type === "success" ? "check-circle" : "info-circle"}"></i>
        <span>${message}</span>
        <button class="alert-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `

  // Insert after header
  const header = document.querySelector(".login-header")
  header.insertAdjacentElement("afterend", alert)

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (alert.parentElement) {
      alert.remove()
    }
  }, 5000)
}

function closeAlert(alertId) {
  const alert = document.getElementById(alertId)
  if (alert) {
    alert.style.animation = "slideUp 0.3s ease-out reverse"
    setTimeout(() => alert.remove(), 300)
  }
}

function showForgotPassword() {
  showModal("forgotPasswordModal")
}

function showAbout() {
  showModal("aboutModal")
}

function showHelp() {
  showAlert("For help, please contact your system administrator or IT support team.", "info")
}

function showContact() {
  showAlert("Contact: support@company.com | Phone: +1 (555) 123-4567", "info")
}

function showModal(modalId) {
  const modal = document.getElementById(modalId)
  if (modal) {
    modal.style.display = "block"
    document.body.style.overflow = "hidden"

    // Focus on first input in modal
    const firstInput = modal.querySelector("input")
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100)
    }
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId)
  if (modal) {
    modal.style.display = "none"
    document.body.style.overflow = "auto"
  }
}

function closeAllModals() {
  const modals = document.querySelectorAll(".modal")
  modals.forEach((modal) => {
    modal.style.display = "none"
  })
  document.body.style.overflow = "auto"
}

function checkSavedCredentials() {
  // Check if remember me was previously selected
  const rememberMe = localStorage.getItem("rememberMe")
  const savedEmployeeId = localStorage.getItem("savedEmployeeId")

  if (rememberMe === "true" && savedEmployeeId) {
    document.getElementById("employeeId").value = savedEmployeeId
    document.getElementById("rememberMe").checked = true
    document.getElementById("password").focus()
  }
}

// Handle remember me functionality
document.addEventListener("change", (e) => {
  if (e.target.id === "rememberMe") {
    const employeeIdInput = document.getElementById("employeeId")

    if (e.target.checked && employeeIdInput.value) {
      localStorage.setItem("rememberMe", "true")
      localStorage.setItem("savedEmployeeId", employeeIdInput.value)
    } else {
      localStorage.removeItem("rememberMe")
      localStorage.removeItem("savedEmployeeId")
    }
  }
})

// Handle modal form submissions
document.addEventListener("submit", (e) => {
  if (e.target.classList.contains("modal-form")) {
    e.preventDefault()

    if (e.target.closest("#forgotPasswordModal")) {
      const employeeId = e.target.querySelector("#resetEmployeeId").value
      showAlert(`Password reset instructions sent for Employee ID: ${employeeId}`, "success")
      closeModal("forgotPasswordModal")
    }
  }
})

// Close modal when clicking outside
window.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal")) {
    closeModal(e.target.id)
  }
})
