const KEY = 'docchat-theme'

export const getTheme = () => localStorage.getItem(KEY) || 'dark'

export const applyTheme = (theme) => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem(KEY, theme)
}
