export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import Image from "next/image";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const BG_MUSIC_URL =
  "https://hwuhwqmixioehvshmila.supabase.co/storage/v1/object/public/menu-music/bg-tr-1.mp3";

// ─── Types ───
interface Ingredient {
  name_en: string;
  name_tr: string;
  quantity: number;
  unit: string;
}

interface Dish {
  title_en?: string;
  title_tr?: string;
  description_en?: string;
  description_tr?: string;
  ingredients?: Ingredient[];
  serving_size_g?: number;
  diet_tags?: string[];
}

interface MenuData {
  soup?: Dish;
  main?: Dish;
  salad?: Dish;
  side?: Dish;
}

interface MediaDish {
  images?: string[];
  video?: string | null;
}

interface MediaData {
  soup?: MediaDish;
  main?: MediaDish;
  salad?: MediaDish;
  side?: MediaDish;
}

// ─── Dish Card Component ───
function DishCard({
  label,
  labelTr,
  emoji,
  dish,
  media,
}: {
  label: string;
  labelTr: string;
  emoji: string;
  dish?: Dish;
  media?: MediaDish;
}) {
  const images = media?.images || [];

  return (
    <section className="dish-card">
      <div className="dish-header">
        <span className="dish-emoji">{emoji}</span>
        <div>
          <span className="dish-label">
            {label} / {labelTr}
          </span>
          <h2 className="dish-title">{dish?.title_en ?? "—"}</h2>
          <h3 className="dish-title-tr">{dish?.title_tr ?? ""}</h3>
        </div>
      </div>

      {dish?.description_en && (
        <p className="dish-desc">{dish.description_en}</p>
      )}
      {dish?.description_tr && (
        <p className="dish-desc-tr">{dish.description_tr}</p>
      )}

      {images.length > 0 && (
        <div className="dish-image-wrap">
          <Image
            src={images[0]}
            alt={dish?.title_en ?? label}
            width={800}
            height={600}
            className="dish-image"
            priority
          />
        </div>
      )}

      {dish?.diet_tags && dish.diet_tags.length > 0 && (
        <div className="diet-tags">
          {dish.diet_tags.map((tag, i) => (
            <span key={i} className="diet-tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      {dish?.ingredients && dish.ingredients.length > 0 && (
        <details className="ingredients-details">
          <summary>Ingredients / Malzemeler</summary>
          <ul className="ingredients-list">
            {dish.ingredients.map((ing, idx) => (
              <li key={idx}>
                <span className="ing-amount">
                  {ing.quantity} {ing.unit}
                </span>{" "}
                <span className="ing-name">
                  {ing.name_en}
                  <span className="ing-name-tr"> / {ing.name_tr}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {dish?.serving_size_g && (
        <div className="serving-info">
          Serving: {dish.serving_size_g}g / Porsiyon: {dish.serving_size_g}g
        </div>
      )}
    </section>
  );
}

// ─── Main Page ───
export default async function Home() {
  const today = new Date().toISOString().slice(0, 10);

  // Try to get today's published menu
  const { data: todayMenu, error: errToday } = await supabase
    .from("daily_menus")
    .select("menu_date, status, menu_json, media_json")
    .eq("status", "published")
    .eq("menu_date", today)
    .maybeSingle();

  if (errToday) {
    return (
      <main className="page-container">
        <div className="error-state">
          <p>Something went wrong. Please try again later.</p>
        </div>
      </main>
    );
  }

  // Fallback to latest published
  const { data: latestMenu } = todayMenu
    ? { data: null }
    : await supabase
        .from("daily_menus")
        .select("menu_date, status, menu_json, media_json")
        .eq("status", "published")
        .order("menu_date", { ascending: false })
        .limit(1)
        .maybeSingle();

  const data = todayMenu ?? latestMenu;

  if (!data) {
    return (
      <main className="page-container">
        <div className="empty-state">
          <div className="empty-icon">🍽️</div>
          <h1>Daily Menu</h1>
          <p>Today&apos;s menu is being prepared. Check back soon!</p>
          <p className="empty-sub">
            Günün menüsü hazırlanıyor. Lütfen daha sonra tekrar kontrol edin!
          </p>
        </div>
      </main>
    );
  }

  const menuJson = (data as Record<string, unknown>).menu_json as Record<string, unknown> | null;
  const menu = (menuJson?.menu as MenuData) || (menuJson as unknown as MenuData);
  const media = ((data as Record<string, unknown>).media_json as MediaData) || {};
  const menuDate = (data as Record<string, unknown>).menu_date as string;
  const isToday = menuDate === today;

  // Format date nicely
  const dateObj = new Date(menuDate + "T00:00:00");
  const formattedDate = dateObj.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedDateTr = dateObj.toLocaleDateString("tr-TR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="page-container">
      {/* Header */}
      <header className="page-header">
        <div className="header-badge">
          {isToday ? "Today's Menu" : "Latest Menu"}
        </div>
        <h1 className="header-title">
          Günün Menüsü
          <span className="header-sub">Daily Menu</span>
        </h1>
        <div className="header-date">
          <span>{formattedDateTr}</span>
          <span className="date-en">{formattedDate}</span>
        </div>

        {/* Music Player */}
        <div className="music-player">
          <span className="music-icon">♪</span>
          <audio controls loop preload="none" className="audio-el">
            <source src={BG_MUSIC_URL} type="audio/mpeg" />
          </audio>
        </div>
      </header>

      {/* Halal badge */}
      <div className="halal-badge">
        <span>✓</span> Halal — No pork, no alcohol
        <span className="halal-tr">
          | Helal — Domuz eti yok, alkol yok
        </span>
      </div>

      {/* Dishes */}
      <div className="dishes-grid">
        <DishCard
          label="Soup"
          labelTr="Çorba"
          emoji="🍜"
          dish={menu?.soup}
          media={media?.soup}
        />
        <DishCard
          label="Main"
          labelTr="Ana Yemek"
          emoji="🥘"
          dish={menu?.main}
          media={media?.main}
        />
        <DishCard
          label="Salad"
          labelTr="Salata"
          emoji="🥗"
          dish={menu?.salad}
          media={media?.salad}
        />
        <DishCard
          label="Side"
          labelTr="Yan Yemek"
          emoji="🍚"
          dish={menu?.side}
          media={media?.side}
        />
      </div>

      {/* Footer */}
      <footer className="page-footer">
        <p>
          Menu generated with AI — ingredients may vary
          <br />
          Menü yapay zeka ile oluşturulmuştur — malzemeler değişebilir
        </p>
      </footer>
    </main>
  );
}
