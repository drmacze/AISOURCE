import { Shield, Lock, Database, Globe, Mail, ChevronRight } from "lucide-react";
import { motion } from "framer-motion";

const LAST_UPDATED = "17 Juni 2026";
const APP_NAME = "DLavie OS";
const CONTACT_EMAIL = "privacy@dlavie.ai";

function Section({ id, title, icon: Icon, children }: {
  id: string;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-border/50 bg-card overflow-hidden"
    >
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/40 bg-muted/20">
        <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center flex-shrink-0">
          <Icon className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="font-semibold text-sm text-foreground">{title}</h2>
      </div>
      <div className="px-5 py-4 space-y-3 text-sm text-muted-foreground leading-relaxed">
        {children}
      </div>
    </motion.section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>;
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <ChevronRight className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
      <span>{children}</span>
    </li>
  );
}

function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1.5 ml-1">{children}</ul>;
}

export default function PrivacyPolicyPage() {
  const toc = [
    { id: "informasi",    label: "Informasi yang Dikumpulkan" },
    { id: "penggunaan",   label: "Cara Penggunaan Informasi" },
    { id: "penyimpanan",  label: "Penyimpanan & Keamanan Data" },
    { id: "berbagi",      label: "Berbagi Data dengan Pihak Ketiga" },
    { id: "lokal",        label: "Prinsip Lokal & Privasi AI" },
    { id: "hak",          label: "Hak Pengguna" },
    { id: "cookies",      label: "Cookies & Penyimpanan Lokal" },
    { id: "anak",         label: "Privasi Anak-Anak" },
    { id: "perubahan",    label: "Perubahan Kebijakan" },
    { id: "kontak",       label: "Hubungi Kami" },
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center flex-shrink-0">
              <Shield className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "Syne, sans-serif" }}>
                Kebijakan Privasi
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {APP_NAME} — AI Command Center
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Terakhir diperbarui: <span className="text-foreground">{LAST_UPDATED}</span>
              </p>
            </div>
          </div>

          {/* Intro */}
          <div className="mt-5 px-4 py-3.5 rounded-xl border border-primary/20 bg-primary/5">
            <p className="text-sm text-foreground/90 leading-relaxed">
              Selamat datang di <strong className="text-primary">{APP_NAME}</strong>. Kami berkomitmen untuk melindungi privasi dan keamanan data Anda.
              Kebijakan ini menjelaskan bagaimana kami mengumpulkan, menggunakan, dan melindungi informasi Anda
              saat menggunakan platform AI Command Center kami.
            </p>
          </div>
        </motion.div>

        {/* Table of Contents */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
          className="rounded-xl border border-border/40 bg-muted/10 p-4"
        >
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Daftar Isi</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {toc.map(({ id, label }, i) => (
              <a key={id} href={`#${id}`}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors group"
              >
                <span className="w-4 h-4 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[9px] text-primary font-bold flex-shrink-0 group-hover:bg-primary/20">
                  {i + 1}
                </span>
                {label}
              </a>
            ))}
          </div>
        </motion.div>

        {/* 1. Informasi yang Dikumpulkan */}
        <Section id="informasi" title="1. Informasi yang Dikumpulkan" icon={Database}>
          <P>
            {APP_NAME} adalah platform yang dirancang untuk beroperasi secara <strong className="text-foreground">lokal</strong>.
            Kami meminimalkan pengumpulan data dan hanya menyimpan informasi yang diperlukan untuk fungsi aplikasi.
          </P>
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Data yang disimpan di server Anda:</p>
            <Ul>
              <Li>Percakapan (conversations) dan pesan yang Anda buat di fitur Chat</Li>
              <Li>Dokumen yang Anda upload ke Knowledge Base (RAG)</Li>
              <Li>Training samples dan dataset untuk fine-tuning AI</Li>
              <Li>Pengaturan aplikasi dan konfigurasi model AI</Li>
              <Li>Log aktivitas sistem untuk keperluan debugging</Li>
            </Ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground mb-2">Data yang TIDAK kami kumpulkan:</p>
            <Ul>
              <Li>Informasi pribadi seperti nama lengkap, alamat, atau nomor telepon</Li>
              <Li>Data pembayaran atau kartu kredit</Li>
              <Li>Riwayat browsing atau aktivitas di luar aplikasi</Li>
              <Li>Data biometrik atau informasi sensitif lainnya</Li>
            </Ul>
          </div>
        </Section>

        {/* 2. Cara Penggunaan Informasi */}
        <Section id="penggunaan" title="2. Cara Penggunaan Informasi" icon={Globe}>
          <P>Informasi yang tersimpan digunakan semata-mata untuk:</P>
          <Ul>
            <Li>Menyediakan fitur Chat AI, Knowledge Base, dan Training Hub yang fungsional</Li>
            <Li>Meningkatkan kualitas respons AI melalui fine-tuning lokal</Li>
            <Li>Menjaga stabilitas dan performa sistem (monitoring uptime, error logging)</Li>
            <Li>Memungkinkan integrasi dengan tools eksternal yang Anda aktifkan (ChatGPT Actions, MCP, Telegram Bot)</Li>
          </Ul>
          <P>
            <strong className="text-foreground">Kami tidak menggunakan data Anda untuk iklan, profiling, atau dijual kepada pihak ketiga.</strong>
          </P>
        </Section>

        {/* 3. Penyimpanan & Keamanan */}
        <Section id="penyimpanan" title="3. Penyimpanan & Keamanan Data" icon={Lock}>
          <P>
            Semua data disimpan dalam database PostgreSQL yang berjalan di server yang Anda kelola sendiri (self-hosted).
            {APP_NAME} tidak memiliki akses ke database Anda kecuali Anda secara eksplisit memberikan akses.
          </P>
          <Ul>
            <Li>Data dienkripsi dalam transit menggunakan HTTPS/TLS</Li>
            <Li>API Keys dan secrets disimpan sebagai environment variables, bukan di database</Li>
            <Li>Autentikasi menggunakan API Key sistem (<code className="bg-muted/50 px-1 rounded text-[11px]">DLAVIE_API_KEY</code>) yang Anda tentukan sendiri</Li>
            <Li>Tidak ada akses remote ke data Anda tanpa konfigurasi eksplisit dari Anda</Li>
          </Ul>
          <div className="px-3 py-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-300/80">
            <strong>Catatan keamanan:</strong> Keamanan data Anda bergantung pada keamanan environment tempat Anda menjalankan {APP_NAME}.
            Pastikan untuk mengatur API Key yang kuat dan tidak membagikan credentials kepada pihak yang tidak dipercaya.
          </div>
        </Section>

        {/* 4. Berbagi Data */}
        <Section id="berbagi" title="4. Berbagi Data dengan Pihak Ketiga" icon={Globe}>
          <P>
            {APP_NAME} dapat terhubung ke layanan pihak ketiga <em>hanya jika Anda mengkonfigurasinya secara eksplisit</em>:
          </P>
          <Ul>
            <Li>
              <strong className="text-foreground">Groq / OpenRouter / HuggingFace:</strong> Pesan Anda dikirim ke provider AI ini untuk inference
              jika Anda mengaktifkannya. Kebijakan privasi mereka berlaku secara terpisah.
            </Li>
            <Li>
              <strong className="text-foreground">Ollama (lokal):</strong> Default provider — berjalan 100% lokal, tidak ada data keluar dari server Anda.
            </Li>
            <Li>
              <strong className="text-foreground">Kaggle:</strong> Dataset training dikirim ke Kaggle hanya jika Anda memicu fitur GPU Training.
            </Li>
            <Li>
              <strong className="text-foreground">Telegram / WhatsApp Bot:</strong> Pesan dari bot diteruskan ke sistem AI lokal Anda.
            </Li>
            <Li>
              <strong className="text-foreground">ChatGPT Actions:</strong> ChatGPT dapat mengakses API {APP_NAME} jika Anda mengkonfigurasi GPT Actions.
            </Li>
          </Ul>
          <P>
            Kami <strong className="text-foreground">tidak</strong> secara proaktif berbagi, menjual, atau menyewakan data Anda kepada pihak ketiga manapun.
          </P>
        </Section>

        {/* 5. Prinsip Lokal & Privasi AI */}
        <Section id="lokal" title="5. Prinsip Lokal & Privasi AI" icon={Shield}>
          <P>
            {APP_NAME} dirancang dengan filosofi <strong className="text-foreground">local-first AI</strong> — AI berjalan di server Anda,
            bukan di cloud pihak ketiga. Ini berarti:
          </P>
          <Ul>
            <Li>Percakapan dengan AI lokal (via Ollama/TinyLlama) tidak pernah meninggalkan server Anda</Li>
            <Li>Model AI berjalan di infrastruktur yang Anda kontrol</Li>
            <Li>Tidak ada telemetry atau analytics yang dikirim ke developer {APP_NAME}</Li>
            <Li>Anda memiliki kendali penuh atas model AI mana yang digunakan</Li>
          </Ul>
        </Section>

        {/* 6. Hak Pengguna */}
        <Section id="hak" title="6. Hak Pengguna" icon={Shield}>
          <P>Sebagai pengguna {APP_NAME}, Anda memiliki hak penuh atas data Anda:</P>
          <Ul>
            <Li><strong className="text-foreground">Akses:</strong> Anda dapat mengakses semua data Anda melalui API atau antarmuka aplikasi kapan saja</Li>
            <Li><strong className="text-foreground">Penghapusan:</strong> Anda dapat menghapus percakapan, dokumen, dan training data kapan saja melalui aplikasi</Li>
            <Li><strong className="text-foreground">Portabilitas:</strong> Data dapat diekspor melalui API endpoint yang tersedia</Li>
            <Li><strong className="text-foreground">Kontrol:</strong> Anda dapat menonaktifkan integrasi pihak ketiga kapan saja melalui Settings</Li>
            <Li><strong className="text-foreground">Kepemilikan:</strong> Karena self-hosted, Anda adalah pemilik penuh database dan semua data di dalamnya</Li>
          </Ul>
        </Section>

        {/* 7. Cookies */}
        <Section id="cookies" title="7. Cookies & Penyimpanan Lokal" icon={Database}>
          <P>
            {APP_NAME} menggunakan penyimpanan lokal browser (<code className="bg-muted/50 px-1 rounded text-[11px]">localStorage</code>) untuk:
          </P>
          <Ul>
            <Li>Menyimpan preferensi tampilan (tema, sidebar state)</Li>
            <Li>Cache sementara untuk performa UI yang lebih baik</Li>
            <Li>Status koneksi dan pengaturan sesi</Li>
          </Ul>
          <P>
            Kami <strong className="text-foreground">tidak menggunakan cookies pelacak</strong> atau analytics cookies pihak ketiga.
            Tidak ada cookie yang dikirim ke server eksternal.
          </P>
        </Section>

        {/* 8. Anak-anak */}
        <Section id="anak" title="8. Privasi Anak-Anak" icon={Shield}>
          <P>
            {APP_NAME} tidak dirancang untuk atau ditujukan kepada anak-anak di bawah usia 13 tahun.
            Kami tidak secara sengaja mengumpulkan informasi pribadi dari anak-anak.
            Jika Anda adalah orang tua atau wali dan percaya bahwa anak Anda telah memberikan informasi pribadi,
            hubungi kami segera untuk penghapusan data.
          </P>
        </Section>

        {/* 9. Perubahan */}
        <Section id="perubahan" title="9. Perubahan Kebijakan Privasi" icon={Globe}>
          <P>
            Kami dapat memperbarui Kebijakan Privasi ini dari waktu ke waktu. Perubahan signifikan akan diumumkan
            melalui:
          </P>
          <Ul>
            <Li>Notifikasi di Dashboard {APP_NAME}</Li>
            <Li>Update tanggal "Terakhir diperbarui" di bagian atas halaman ini</Li>
          </Ul>
          <P>
            Penggunaan berkelanjutan atas layanan kami setelah perubahan dianggap sebagai penerimaan kebijakan yang diperbarui.
            Kami mendorong Anda untuk meninjau kebijakan ini secara berkala.
          </P>
        </Section>

        {/* 10. Kontak */}
        <Section id="kontak" title="10. Hubungi Kami" icon={Mail}>
          <P>
            Jika Anda memiliki pertanyaan, kekhawatiran, atau permintaan terkait privasi data Anda,
            jangan ragu untuk menghubungi kami:
          </P>
          <div className="px-4 py-3 rounded-lg border border-border/40 bg-muted/10 space-y-2">
            <div className="flex items-center gap-2">
              <Mail className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline text-sm font-mono">
                {CONTACT_EMAIL}
              </a>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span className="text-sm">
                Melalui fitur{" "}
                <a href="/chat" className="text-primary hover:underline">Chat AI</a>{" "}
                di {APP_NAME} (respons otomatis)
              </span>
            </div>
          </div>
          <P>
            Kami berkomitmen untuk merespons pertanyaan privasi dalam waktu <strong className="text-foreground">72 jam kerja</strong>.
          </P>
        </Section>

        {/* Footer */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          className="text-center py-4 text-xs text-muted-foreground space-y-1 border-t border-border/30"
        >
          <p>© {new Date().getFullYear()} {APP_NAME} — AI Command Center. Semua hak dilindungi.</p>
          <p>Kebijakan ini berlaku untuk semua pengguna platform {APP_NAME}.</p>
          <p className="text-[11px] text-muted-foreground/60">Versi 1.0 · Terakhir diperbarui: {LAST_UPDATED}</p>
        </motion.div>

      </div>
    </div>
  );
}
