# Noćna Straža v86 — Cloud profil + Google prijava

Mobilna HTML igra (do 6 igrača u multiplayeru), sa dekorativnim kamenčićima iz v81, lobby chatom i optimizacijama iz v80.

**Prijava**: Firebase Authentication (email/lozinka, Google, verifikacija emaila, reset lozinke, zadržavanje prijave, povezivanje Google naloga).
**Napredak**: Cloud Firestore — po jedan bezbedan privatni direktorijum po korisniku, sinhronizacija lokalnih sačuvanih podataka u delovima, rezervne kopije JSON. Podaci su korisnički kontrolisani, ne dokazuju automatski poštene multiplayer nagrade.
**Hosting**: Cloudflare Workers Static Assets (ili postojeći GitHub Pages).

## Jedan klik: objavljivanje verzije

[**🚀 Deploy v86 to Cloudflare**](https://deploy.workers.cloudflare.com/?url=https://github.com/MajorStex/nocna-straza-v77)

Ovo objavljuje novu verziju koda, **ali samo po sebi NE aktivira Firebase prijavu**. Potreban je jednokratni vlasnički setup ispod. Cloudflare može da napravi novi Worker i dodeli novi `workers.dev` URL; ovo ne garantuje zamenu starog `pages.dev` sajta.

## Jednokratno podešavanje na telefonu (vlasnik igre)

1. Otvori https://console.firebase.google.com/ -> **Create project** -> izaberi **Spark / no-cost**. Projekat nazovi recimo `nocna-straza-accounts`.
2. Firebase -> **Build / Authentication** -> **Get started**, zatim u **Sign-in method** uključi **Email/Password** i **Google**. Za Google izaberi kontakt email. U **Settings -> Authorized domains** dodaj javni domen igre (npr. `majorstex.github.io`; kasnije i tačan `IME.wORKERS.dev`). Bez ovoga Google prijava neće raditi.
3. Firebase -> **Firestore Database** -> **Create database** -> izaberi standardni Firestore u **production mode**, podrazumevanu bazu, i lokaciju blizu korisnika. Otvori karticu **Rules**.
4. Kopiraj **celokupan tekst** datoteke [`firestore.rules`](./firestore.rules) u Firebase Rules i klikni **Publish**. Ovo je neophodno da svaki igrač može da čita i piše samo sopstvene podatke.
5. Firebase -> **Project settings** (zupčanik) -> **Your apps** -> **Web app (`</>`)** -> Register app. U prikazanom `firebaseConfig` kopiraj javna polja `apiKey`, `authDomain`, `projectId` i `appId`.
6. Otvori **[GitHub fajl za konfiguraciju](https://github.com/MajorStex/nocna-straza-v77/edit/main/public/firebase-config.js)** -> nalepi četiri vrednosti u navodnicima -> **Commit changes**. Ne ubacuj privatne server ključeve, JSON service account niti lozinke.
7. Objavi / ponovo objavi Cloudflare Worker koristeći link gore ili sačekaj GitHub integraciju ako je automatski deploy uključen. Poseti URL Workers projekta. Ako koristiš i GitHub Pages, iste javne Firebase vrednosti treba da budu u `nocna-straza-v86/firebase-config.js` u tom repozitorijumu.
8. U igri odaberi **SIGN UP / REGISTRACIJA**, probaj svoj email, proveri poruku za potvrdu, prijavi se na drugom telefonu i proveri vraćanje napretka. Onda probaj Google, reset lozinke i zadržavanje prijave.

**Korisnik ne čuva stvarnu lozinku u fajlu igre.** Opcija „Zapamti me” čuva Firebase sesiju, a čuvanje same lozinke nudi Chrome/Android password manager.

## Gde su podaci i ograničenja

- Primarni cloud zapis: Firebase Firestore `users/{uid}/saves/{encodedKey}~{part}`. Sigurnosna pravila ograničavaju pristup na sopstveni `uid`, uz ograničenja tipova/veličine.
- Firebase Authentication čuva naloge/lozinke; HTML igra **ne čuva lozinke**. Firebase Web config nije tajna, ali Firestore rules MORAJU biti objavljena.
- Svaki profil može da prebaci istorijski lokalni napredak **sa iste adrese/domena pregledača** pri prvom povezivanju. Drugi domen (`workers.dev` vs `github.io` vs `pages.dev`) ima odvojenu memoriju — za prelaz koristi JSON export/import, ako imaš pristup starom profilu na originalnom domenu.
- Neke stvari su lokalne dok se ne razvije poseban medijski backend: **snimljeni glasovi u IndexedDB nisu automatski deo cloud sinhronizacije**. Snimke treba ponovo importovati na novom telefonu. Igra i dalje čuva zvuk na uređaju.
- Pristup oblaku traži internet. Ako Cloud ne radi, lokalni napredak ostaje na telefonu; pre brisanja podataka preglednika izvezi JSON backup.
- Firebase Spark i Firestore besplatni nivo imaju kvote i ograničenja i mogu pauzirati cloud operacije kada se prekorače. Za ozbiljan produkcioni shop/prodaju i anti-cheat nagrade potreban je dodatni server-autoritativni sistem.

## Fajlovi

- `public/index.html` — kompletna HTML igra v86 sa novim ekranima naloga.
- `public/auth-v86.js` — klijentska autentifikacija, sinhronizacija i backup.
- `public/firebase-config.js` — Firebase javna konfiguracija, za uređivanje.
- `firestore.rules` — pravila privatnosti i veličine korisničkih zapisa.
- `wrangler.jsonc` — Cloudflare static assets configuration.
- `package.json` — deploy preko Wrangler-a.

## Testiranje

Browser simulacije sa lažnim Firebase servisom proveravaju UI, kreiranje naloga, reset lozinke, Google, import profila, cloud čuvanje u delovima, brisanje i slučaj kada Firebase projekat još nije podešen. **Nije izvršen stvarni produkcioni Firebase login** jer korisnički Firebase projekat još nije podešen.

## v86 mobile login UI fix
- When Firebase is not configured, hide the unusable email/password and Google buttons.
- Display a compact guest-play button, collapsible local-save export, and step-by-step owner setup guide.
- Email/Google/Forgot Password and cloud saves only become active after Firebase configuration and security rules are installed.

## Android Back / Nazad (v86)

- Sistemsku Android strelicu **Nazad** igra obrađuje unutar ekrana kroz History API (`popstate`).
- Ekran naloga: sa registracije na prijavu, zatim na lokalnu igru.
- Podešavanja, lobby, editor, mapa, profil i priprema partije: Back zatvara jedan nivo.
- Tokom borbe: prvi Back otvara pauzu, sledeći nastavlja igru.
- Na glavnom meniju: prvi Back prikazuje upozorenje, drugi u roku od 2.2 sekunde dopušta izlaz iz browsera. Android in-app browser može drugačije reagovati.
- Novo vidljivo dugme BACK / NAZAD je prisutno u podmenijima, ali ne zaklanja izbor jezika na glavnom meniju.

## v86: smanjen lag kod gostiju

- Na uskim mobilnim ekranima podloga se kešira u malim determinističkim Canvas pločicama; na velikim ekranima koristi se direktno crtanje da se izbegne usporenje usled skaliranja velikih slika.
- Keš čuva samo vizuelne piksele. Ne zamrzava neprijatelje, sudare, štetu ili multiplayer stanje.
- Rezervna migraciona slika celog sveta šalje se na oko 5,2 sekunde umesto na 3 sekunde; važi prozor svežine 9,5 sekundi.
- Položaji neprijatelja za mrežne snimke šalju se na desetinku piksela radi manje vidljivog poskakivanja.
- Prikaz ikonica sposobnosti kod gostiju ne rekreira se posle svakog nepromenjenog snimka.
- Browser testovi: 14/14 sa tri učesnika pri normalnom opterećenju u ranijem prolazu; 23/23 u protokolskom testu šest igrača sa simuliranim kašnjenjem i isključenim Canvas crtanjem. Uporedni lokalni Canvas test: 390×820 je ubrzan, dok je veliki ekran sačuvan na staroj metodi.
- Ovo nije test na šest fizičkih telefona ili javnom Cloudflare relay serveru. Pravi FPS i ping zavise od telefona, mreže i poslužitelja.

**Objavljivanje:** GitHub Pages: https://majorstex.github.io/nocna-straza-v86/ ; Cloudflare Workers: https://deploy.workers.cloudflare.com/?url=https://github.com/MajorStex/nocna-straza-v77

## v86: popravka Back dugmadi na telefonu

- Na pripremi partije, lobbyju, pauzi, podešavanjima i ostalim otvorenim panelima koristi se postojeće Back dugme bez plutajućeg duplikata preko sadržaja.
- Plutajuće Back dugme se prikazuje **samo u aktivnoj igri** (HUD vidljiv, bez modalnog panela).
- Android donja strelica nastavlja da koristi postojeću History API navigaciju, bez novog per-frame rada ili mrežnih paketa.
- Playwright Chromium test odvojene UI komponente: 28/28 provera vidljivosti na 360×740, 390×844, 412×915 i 1024×768.
- Test je simulacija prikaza, ne potvrda na fizičkom telefonu.
