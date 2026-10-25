import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CartItem, Product } from './types'

const STORAGE_KEY = 'asm.cart.v1'

interface CartContextValue {
  items: CartItem[]
  count: number
  subtotal: number
  add: (product: Product, quantity?: number) => { ok: boolean; message: string }
  setQuantity: (productId: string, quantity: number) => void
  remove: (productId: string) => void
  clear: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

function read(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item && typeof item.product_id === 'string')
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(read)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items])

  const add = useCallback((product: Product, quantity = 1) => {
    const limit = Math.min(product.stock, 10)
    if (product.stock < 1) return { ok: false, message: `${product.name} is out of stock` }
    let result = { ok: true, message: 'Added to cart' }
    setItems((current) => {
      const existing = current.find((item) => item.product_id === product.id)
      if (existing) {
        const nextQty = existing.quantity + quantity
        if (nextQty > limit) {
          result = { ok: false, message: `Only ${limit} available — cart already has ${existing.quantity}` }
          return current
        }
        result = { ok: true, message: 'Cart updated' }
        return current.map((item) =>
          item.product_id === product.id
            ? { ...item, quantity: nextQty, stock: product.stock, price_paise: product.price_paise }
            : item,
        )
      }
      return [
        ...current,
        {
          product_id: product.id,
          slug: product.slug,
          name: product.name,
          price_paise: product.price_paise,
          mrp_paise: product.mrp_paise,
          image_url: product.image_url,
          unit: product.unit,
          stock: product.stock,
          quantity: Math.min(quantity, limit),
          category_slug: product.category?.slug ?? null,
        },
      ]
    })
    return result
  }, [])

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setItems((current) =>
      current
        .map((item) =>
          item.product_id === productId
            ? { ...item, quantity: Math.max(0, Math.min(quantity, Math.min(item.stock, 10))) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    )
  }, [])

  const remove = useCallback((productId: string) => {
    setItems((current) => current.filter((item) => item.product_id !== productId))
  }, [])

  const clear = useCallback(() => setItems([]), [])

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      count: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: items.reduce((sum, item) => sum + item.price_paise * item.quantity, 0),
      add,
      setQuantity,
      remove,
      clear,
    }),
    [items, add, setQuantity, remove, clear],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}

export function cartPayload(items: CartItem[]) {
  return items.map((item) => ({ product_id: item.product_id, quantity: item.quantity }))
}
