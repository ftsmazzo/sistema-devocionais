import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '../types'
import { authApi } from '../services/api'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string, remember?: boolean) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string, remember = false) => {
        set({ isLoading: true })
        try {
          const response = await authApi.login({ email, password, remember })
          
          localStorage.setItem('token', response.token)
          if (remember) {
            localStorage.setItem('user', JSON.stringify(response.user))
          }

          set({
            user: response.user,
            token: response.token,
            isAuthenticated: true,
            isLoading: false,
          })
        } catch (error) {
          set({ isLoading: false })
          throw error
        }
      },

      logout: async () => {
        try {
          await authApi.logout()
        } catch (error) {
          console.error('Erro ao fazer logout:', error)
        } finally {
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          set({
            user: null,
            token: null,
            isAuthenticated: false,
          })
        }
      },

      checkAuth: async () => {
        const token = localStorage.getItem('token')
        if (token) {
          try {
            const user = await authApi.getCurrentUser()
            set({
              user,
              token,
              isAuthenticated: true,
            })
          } catch (error) {
            localStorage.removeItem('token')
            localStorage.removeItem('user')
            set({
              user: null,
              token: null,
              isAuthenticated: false,
            })
          }
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)

