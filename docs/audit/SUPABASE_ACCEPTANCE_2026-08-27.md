# Supabase kabul kaydı — 27 Ağustos 2026

Kapsam: bağlı mrap kabul projesi. Secret, kullanıcı kimliği ve claim/post kimliği bu
rapora yazılmamıştır.

## Geçen kapılar

1. `001`–`015` migration zinciri uzak projeye sıralı uygulandı.
2. Yerel/uzak migration listeleri `001`–`015` için eşleşti.
3. `supabase db lint --linked --schema public,app_private --level warning --fail-on warning`
   warning veya error üretmeden geçti.
4. Runtime contract şu değişmezleri doğruladı:
   - schema version `15`;
   - production world `world-main`;
   - grid resolution `22`;
   - authoritative rule sayısı `22`;
   - dissolved territory, region map state, distributed rate limit ve outbox
     sözleşmeleri hazır.
5. Uzak HTTP ürün smoke testi iki geçici kullanıcıyla şu akışı tamamladı:
   Auth → gerçek sunucu-otoriter claim → gönderi → yorum → beğeni → kaydetme →
   takip → bildirim → hesap silme.
6. Temizlik her geçici kullanıcı için Supabase Auth kaydı, `profiles` satırı ve
   `territory_cells.owner_id` sayısı `0` olacak şekilde doğrulandı.
7. `world-main` testten sonra `draft` ve rekabetçi claim kapalı kaldı.

## Bilinçli olarak kapsam dışında

- Vercel production deployment ve custom domain;
- Cloudflare DNS/TLS/WAF/cache/origin zinciri;
- Turnstile production hostname/secret;
- gerçek e-posta teslimatı;
- private media upload ve EXIF temizliği;
- iki Vercel instance'ı altında realtime backpressure;
- load/soak, PITR restore ve rollback tatbikatı;
- production world activation.

Bu kayıt veritabanı kabul kanıtıdır; production yayın onayı değildir.
