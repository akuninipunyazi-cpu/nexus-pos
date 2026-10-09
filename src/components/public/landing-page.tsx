import Link from "next/link";
import type { PublicSubscriptionPlan } from "@/lib/public-plans";

function formatIdr(amount: number, currency: string) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function limit(value: number | null, unit: string) {
  return value === null ? `Tidak terbatas ${unit}` : `Maks. ${value} ${unit}`;
}

export function LandingPage({
  plans,
  plansAvailable,
  checkoutConfigured,
}: {
  plans: PublicSubscriptionPlan[];
  plansAvailable: boolean;
  checkoutConfigured: boolean;
}) {
  return <main className="landing-page">
    <header className="landing-header">
      <Link className="landing-brand" href="/" aria-label="POS-CAFE beranda">
        <span className="landing-brand-mark" aria-hidden="true">P</span>
        <span>NEXUS</span>
      </Link>
      <nav className="landing-nav" aria-label="Navigasi utama">
        <a href="#alur">Cara kerja</a>
        <a href="#fitur">Fitur</a>
        <a href="#pricing">Paket</a>
        <Link className="landing-nav-login" href="/login">Masuk</Link>
        <a className="landing-nav-cta" href="#pricing">Mulai sekarang <span aria-hidden="true">↗</span></a>
      </nav>
    </header>

    <section className="landing-hero">
      <div className="landing-hero-copy">
        <p className="landing-kicker"><span /> Sistem operasional untuk coffee shop</p>
        <h1>Operasional rapi.<br /><em>Kendali tetap</em> di tangan Anda.</h1>
        <p className="landing-lede">NEXUS menghubungkan order pelanggan, kasir, kitchen, inventory, dan laporan owner dalam satu alur kerja yang jelas.</p>
        <div className="landing-actions">
          <a className="landing-button landing-button-dark" href="#pricing">Lihat paket <span aria-hidden="true">→</span></a>
          <a className="landing-text-link" href="#alur">Lihat cara kerjanya</a>
        </div>
        <p className="landing-microcopy">Untuk coffee shop yang ingin operasional harian lebih terkoordinasi.</p>
      </div>
      <div className="landing-flow-visual" aria-label="Ilustrasi alur kerja POS-CAFE">
        <div className="landing-visual-top"><span>ALUR OPERASIONAL</span><span>NEXUS / 01</span></div>
        <div className="landing-flow-line">
          <div className="landing-flow-step landing-flow-customer"><span className="landing-flow-index">01</span><strong>Order</strong><small>Pelanggan melalui QR</small></div>
          <div className="landing-flow-step"><span className="landing-flow-index">02</span><strong>Bayar</strong><small>Kasir konfirmasi</small></div>
          <div className="landing-flow-step"><span className="landing-flow-index">03</span><strong>Siapkan</strong><small>Kitchen memproses</small></div>
          <div className="landing-flow-step landing-flow-owner"><span className="landing-flow-index">04</span><strong>Pantau</strong><small>Owner melihat kondisi</small></div>
        </div>
        <div className="landing-visual-footer"><span><i /> Status order dan aktivitas tersambung</span><span>ORDER → OPERASIONAL → OWNER</span></div>
      </div>
      <div className="landing-hero-edge" aria-hidden="true">ORDER · CASHIER · KITCHEN · INVENTORY · OWNER</div>
    </section>

    <section className="landing-flow-section landing-section" id="alur">
      <div className="landing-section-intro">
        <p className="landing-kicker">Satu alur, dari depan sampai belakang</p>
        <h2>Aktivitas toko tidak berhenti di struk.</h2>
        <p>Setiap peran bekerja pada sistem yang sama—dengan akses dan tugas yang sesuai.</p>
      </div>
      <ol className="landing-flow-list">
        <li><span>01</span><div><h3>Customer order</h3><p>Pelanggan memesan dari halaman QR meja tanpa harus membuat akun.</p></div><b>ORDER</b></li>
        <li><span>02</span><div><h3>Cashier</h3><p>Kasir menangani pembayaran dan order takeaway melalui alur khusus.</p></div><b>PAYMENT</b></li>
        <li><span>03</span><div><h3>Kitchen</h3><p>Order yang sudah dibayar masuk ke antrean dan statusnya diperbarui oleh tim kitchen.</p></div><b>PREPARATION</b></li>
        <li><span>04</span><div><h3>Inventory</h3><p>Recipe/BOM menghubungkan produk dengan bahan; stok dan aktivitas pembelian tercatat.</p></div><b>STOCK</b></li>
        <li><span>05</span><div><h3>Owner</h3><p>Ringkasan dashboard dan laporan membantu owner meninjau aktivitas toko.</p></div><b>OVERVIEW</b></li>
      </ol>
    </section>

    <section className="landing-capabilities landing-section" id="fitur">
      <div className="landing-capabilities-heading"><p className="landing-kicker">Dibangun untuk ritme coffee shop</p><h2>Tools operasional yang saling terhubung.</h2></div>
      <div className="landing-capability-list">
        <article><span>01 / CUSTOMER</span><div><h3>Pemesanan QR tanpa akun pelanggan</h3><p>Berikan pelanggan akses ke menu dan alur dine-in dari URL QR meja yang sudah dibuat untuk toko.</p></div><b aria-hidden="true">↗</b></article>
        <article><span>02 / CASHIER</span><div><h3>Kasir dengan alur yang terpisah dan jelas</h3><p>Kelola order takeaway dan konfirmasi pembayaran cash tanpa mencampur otoritas kasir dengan order dine-in pelanggan.</p></div><b aria-hidden="true">↗</b></article>
        <article><span>03 / KITCHEN</span><div><h3>Antrean kitchen mengikuti status order</h3><p>Tim kitchen melihat order yang sudah masuk antrean dan memperbarui tahap pengerjaan sesuai kewenangannya.</p></div><b aria-hidden="true">↗</b></article>
        <article><span>04 / INVENTORY</span><div><h3>Stok terhubung dengan recipe dan pembelian</h3><p>Kelola bahan, recipe/BOM, konsumsi, supplier, permintaan pembelian, dan penerimaan dalam satu alur kerja.</p></div><b aria-hidden="true">↗</b></article>
        <article><span>05 / OWNER</span><div><h3>Lihat kondisi toko tanpa menunggu rekap manual</h3><p>Dashboard, analytics, dan laporan merangkum data order, produk, inventory, purchasing, dan operasi yang tercatat.</p></div><b aria-hidden="true">↗</b></article>
      </div>
    </section>

    <section className="landing-pricing landing-section" id="pricing">
      <div className="landing-section-intro">
        <p className="landing-kicker">Paket berlangganan</p>
        <h2>Pilih kapasitas yang sesuai dengan toko Anda.</h2>
        <p>Harga dan batas penggunaan diambil dari paket aktif NEXUS.</p>
      </div>
      {!plansAvailable ? <div className="landing-plan-message" role="status">Paket belum dapat dimuat saat ini. Silakan coba kembali nanti.</div>
        : plans.length === 0 ? <div className="landing-plan-message">Belum ada paket aktif yang tersedia.</div>
        : <div className="landing-plans">
          {plans.map((plan, index) => <article className="landing-plan" key={plan.id}>
            <div className="landing-plan-heading"><span>PAKET {String(index + 1).padStart(2, "0")}</span><h3>{plan.name}</h3></div>
            <div className="landing-plan-price"><strong>{formatIdr(plan.price, plan.currency)}</strong><span> / {plan.duration_days} hari</span></div>
            <ul>
              <li>{limit(plan.max_staff, "staff")}</li>
              <li>{limit(plan.max_products, "produk")}</li>
              <li>{limit(plan.max_tables, "meja")}</li>
              <li>Ordering, kasir, kitchen, dan tools owner yang tersedia</li>
            </ul>
            {plan.can_checkout && checkoutConfigured
              ? <Link className="landing-plan-cta" href={`/register?plan=${encodeURIComponent(plan.code)}`}>Mulai dengan paket ini <span aria-hidden="true">→</span></Link>
              : <span className="landing-plan-unavailable">Checkout online belum tersedia untuk paket ini</span>}
          </article>)}
        </div>}
      {plansAvailable && plans.length > 0 && !checkoutConfigured && <p className="landing-checkout-note">Pendaftaran dan pembayaran online sedang disiapkan. Paket tetap ditampilkan sesuai data yang tersedia.</p>}
      <p className="landing-period-note">Pembayaran diproses melalui hosted checkout Midtrans. Paket aktif setelah status pembayaran dikonfirmasi oleh server.</p>
    </section>

    <section className="landing-faq landing-section" id="faq">
      <div className="landing-section-intro"><p className="landing-kicker">Pertanyaan umum</p><h2>Hal penting sebelum mulai.</h2></div>
      <div className="landing-faq-list">
        <details><summary>Apakah pelanggan perlu membuat akun?</summary><p>Tidak. Pelanggan dapat membuka menu melalui URL QR meja dan melakukan pemesanan tanpa akun.</p></details>
        <details><summary>Apakah NEXUS mendukung dine-in dan takeaway?</summary><p>Ya. Dine-in dimulai dari pemesanan pelanggan melalui QR meja, sedangkan order takeaway menggunakan alur kasir.</p></details>
        <details><summary>Apakah owner dapat melihat laporan?</summary><p>Owner memiliki dashboard, analytics, dan laporan operasional dengan export CSV.</p></details>
        <details><summary>Apakah inventory termasuk?</summary><p>Fitur inventory mencakup bahan, recipe/BOM, pencatatan konsumsi, supplier, dan proses purchasing yang tersedia di sistem.</p></details>
        <details><summary>Bagaimana pembayaran paket dilakukan?</summary><p>Checkout paket menggunakan Midtrans Snap. Tenant dan subscription baru dibuat setelah notifikasi pembayaran tervalidasi di server.</p></details>
        <details><summary>Bagaimana perubahan paket atau perpanjangan?</summary><p>Checkout mandiri saat ini ditujukan untuk pendaftaran workspace baru. Pengelolaan subscription tenant existing tetap melalui proses platform yang tersedia.</p></details>
        <details><summary>Apa yang terjadi ketika subscription berakhir?</summary><p>Subscription akan tercatat sebagai berakhir dan owner dapat melihat pemberitahuannya. Data tenant tidak otomatis dihapus.</p></details>
        <details><summary>Apakah QRIS pelanggan di coffee shop termasuk?</summary><p>Tidak. Midtrans pada halaman ini hanya untuk pembayaran subscription POS-CAFE, bukan pembayaran order pelanggan coffee shop.</p></details>
      </div>
    </section>

    <section className="landing-final-cta"><div><p className="landing-kicker">Mulai dari alur yang lebih jelas</p><h2>Rapikan operasional coffee shop Anda.</h2></div><div><a className="landing-button landing-button-light" href="#pricing">Lihat paket <span aria-hidden="true">→</span></a><Link className="landing-final-login" href="/login">Sudah punya akun? Masuk</Link></div></section>

    <footer className="landing-footer">
      <Link className="landing-brand" href="/"><span className="landing-brand-mark" aria-hidden="true">P</span><span>NEXUS</span></Link>
      <p>Alur operasional coffee shop, dalam satu sistem.</p>
      <nav aria-label="Navigasi footer"><a href="#fitur">Product</a><a href="#pricing">Paket</a><a href="#faq">FAQ</a><Link href="/login">Login</Link><Link href="/register">Register</Link></nav>
      <small>© {new Date().getFullYear()} NEXUS</small>
    </footer>
  </main>;
}
