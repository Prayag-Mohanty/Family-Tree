# 🌳 Family Tree

A small website to keep track of a large family, so you never blank on a relative's name again.

- **Tree view.** Each family is drawn as a tree. Every card shows the person's name, what you call them (e.g. *Bada Bapa*, *Mausi*) and **how they're related to you**, worked out automatically (e.g. *Father's elder brother's son*).
- **People view.** A searchable list grouped into Immediate family / Father's side / Mother's side.
- **Quiz me.** Flash-card quiz ("What's the name of your mother's younger sister?") to help you memorise names before a wedding or visit.
- **Add, edit, delete.** Tap anyone to add a child, spouse, sibling or parent, or to edit notes, photo, city and phone.
- **Search.** Search by name, nickname, city or notes.
- **Backup.** Export and import your tree as JSON from the `⋯` menu.

## Run it

It's plain HTML, CSS and JS with no build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

To put it online, enable **GitHub Pages** for this repo (Settings → Pages → deploy from branch, root folder).

## Where the data lives

Your edits are saved in your browser's local storage, so they stay on that device and in that browser only.
To move the tree to another device, use **⋯ → Export backup** and then **Import backup** on the other device.

Optional: if you commit an exported file as `family.json` next to `index.html`, a fresh browser loads it automatically.
Only do this if the repo is **private**, because it contains names, phone numbers and photos.

## Starter tree

The first load has placeholders for your known structure. Tap each one to enter the real name:

- Paternal grandparents → 4 sons (Father is 2nd)
- Maternal grandparents → Mother (eldest), 2 more daughters, then 1 son
- Father + Mother → You, and a younger sibling

Fill in **Birth order** or **Birth year** so the site can say *elder* or *younger* brother or sister.
