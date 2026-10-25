import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api'

interface State<T> {
  data: T | null
  error: string | null
  loading: boolean
}

export function useApi<T>(path: string | null) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: Boolean(path) })
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (!path) {
      setState({ data: null, error: null, loading: false })
      return
    }
    const id = ++requestId.current
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await api.get<T>(path)
      if (id === requestId.current) setState({ data, error: null, loading: false })
    } catch (error) {
      if (id !== requestId.current) return
      setState({
        data: null,
        error: error instanceof ApiError ? error.message : 'Could not load this page',
        loading: false,
      })
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  return { ...state, reload: load, setData: (data: T) => setState({ data, error: null, loading: false }) }
}
