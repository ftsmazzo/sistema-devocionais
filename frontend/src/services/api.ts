import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// API será reconstruída quando implementarmos o frontend completo
export default api

