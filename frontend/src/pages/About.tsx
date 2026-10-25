import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { rupees } from '../lib/format'
import { IconBox, IconClock, IconPhone, IconPin, IconShield, IconTruck } from '../components/Icons'

export default function About() {
  const { config } = useAuth()
  const store = config?.store

  return (
    <>
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <span>Delivery & returns</span>
      </div>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="kicker">Practical details</div>
            <h1>Delivery, pickup and returns</h1>
            <p>What happens after you place an order at Ankit Stationery Mart.</p>
          </div>
        </div>

        <div className="store-facts" style={{ marginBottom: 28 }}>
          <div>
            <h4>
              <IconTruck size={15} /> Shimla delivery
            </h4>
            <p>
              Free above {rupees(store?.free_shipping_threshold_paise ?? 49900)}; otherwise a flat{' '}
              {rupees(store?.shipping_fee_paise ?? 4900)}. Orders before 4 pm are usually delivered the next
              working day.
            </p>
          </div>
          <div>
            <h4>
              <IconBox size={15} /> Store pickup
            </h4>
            <p>Collect from the counter within two hours during shop hours and pay at pickup if you prefer.</p>
          </div>
          <div>
            <h4>
              <IconClock size={15} /> Shop hours
            </h4>
            <p>{store?.hours}</p>
          </div>
          <div>
            <h4>
              <IconShield size={15} /> Returns & exchange
            </h4>
            <p>
              Unused books and sealed packs can be returned within 7 days with the bill. Printed textbooks are
              exchange-only, and shipping is refunded when the fault is ours.
            </p>
          </div>
        </div>

        <div className="stack" style={{ gap: 18 }}>
          <section className="card">
            <div className="card-head">
              <h3>How an order moves</h3>
            </div>
            <div className="card-body">
              <ol className="timeline">
                <li className="done">
                  <strong>Order placed</strong>
                  <span>Prices and stock are checked on the server, and stock is reserved for you.</span>
                </li>
                <li className="done">
                  <strong>Payment confirmed</strong>
                  <span>
                    {config?.payments.mode === 'mock'
                      ? 'In this demo, payments are simulated but still signature-verified.'
                      : 'Razorpay confirms payment; the signature is verified on our server before dispatch.'}
                  </span>
                </li>
                <li className="done">
                  <strong>Packed at the shop</strong>
                  <span>The counter packs your books and supplies, and adjusts stock in the same system.</span>
                </li>
                <li className="current">
                  <strong>Shipped / out for delivery</strong>
                  <span>Courier and tracking number appear on your order page when available.</span>
                </li>
                <li>
                  <strong>Delivered</strong>
                  <span>Cash-on-delivery orders are collected by the delivery partner.</span>
                </li>
              </ol>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Visit the shop</h3>
            </div>
            <div className="card-body small stack" style={{ gap: 8 }}>
              <div className="row">
                <IconPin size={16} /> {store?.address}
              </div>
              <div className="row">
                <IconPhone size={16} /> {store?.phone} · {store?.email}
              </div>
              <div className="row">
                <IconClock size={16} /> {store?.hours}
              </div>
              <p className="muted" style={{ marginTop: 10 }}>
                Bring the class book list during June–July; the counter holds the school sets and can reserve
                them for pickup.
              </p>
            </div>
          </section>
        </div>
      </section>
    </>
  )
}
