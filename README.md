# Family Tree

One connected family tree for a large family. Find anyone, see who their parents and children are, and keep it up to date.

- **One tree.** Both sides of the family sit in a single layout. A daughter who married into another family is shown with her husband. She also appears among her own siblings as a dashed link card that jumps to her.
- **One family at a time.** Use the **View** menu (e.g. just the maternal side), or click **Show only this family** in anyone's panel. This shows a couple, all their descendants and their spouses, including daughters who married out along with their husbands and children.
- **Connectors.** Every person is linked to their parents and children. Click someone to highlight those links and open their details.
- **Expand and collapse.** The small pill under each couple hides or shows their descendants (`+12` means 12 people are hidden).
- **Find anyone.** Search by name, nickname, city or notes (press `/`). Picking a result opens any collapsed branches, flies to the person and highlights them.
- **Edit.** Add, edit or delete people. From anyone's panel you can add a parent, spouse, sibling or child, and set a photo, birth and death years, city, phone and notes.
- **Backup.** Export and import the whole tree as JSON from the `⋯` menu.
- **Getting around.** Drag to pan, scroll or pinch to zoom, and use **Fit** to see everyone.

## Run it

It's plain HTML, CSS and JS with no build step. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

To put it online, enable **GitHub Pages** for this repo (Settings → Pages → deploy from branch, root folder).

## Where the data lives

Edits are saved in the browser's local storage, so each device and browser keeps its own copy.
To move the tree to another device, use **⋯ → Export backup**, then **Import backup** on the other device.

Optional: if you commit an exported file as `family.json` next to `index.html`, a fresh browser loads it automatically.
Only do this in a **private** repo, because it contains names, phone numbers and photos.

## Starter tree

The first load has placeholders for the known structure. Click each one to enter the real name.

- Paternal grandparents → 4 sons (the 2nd is the father)
- Maternal grandparents → 3 daughters (the 1st is the mother), then 1 son
- Father + Mother → 2 children

Fill in **Birth order** or **Birth year** so siblings appear eldest-first.
