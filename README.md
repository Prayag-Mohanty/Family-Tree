# Family Tree

One connected family tree for a large family. Find anyone, see who their parents and children are, and keep it up to date.

- **One tree.** Both sides of the family sit in a single layout. A daughter who married into another family is shown with her husband. She also appears among her own siblings as a dashed link card that jumps to her.
- **One family at a time.** Use the **View** menu (e.g. just the maternal side), or click **Show only this family** in anyone's panel. This shows a couple, all their descendants and their spouses, including daughters who married out along with their husbands and children.
- **Connectors.** Every person is linked to their parents and children. Click someone to highlight those links and open their details.
- **Families shown twice.** When someone's parents are both in the tree (e.g. a daughter who married into another family in the tree), her couple and children appear under both families. A dotted "same person" line joins her two cards.
- **Cousin seniority.** Every cousin with a birth year gets a small badge (1st, 2nd…) showing their age rank among all cousins of that generation in that family.
- **Relations.** Pick two people to see how they're related and what each calls the other in **Hindi** and **Odia** (e.g. Chacha ji / Dada, Mausi / Mausi, Tai ji / Bada Maa). Tick "the first person is me" to see a table of everyone as related to you. Terms can be edited to match how your family says them.
- **Siblings without parents.** **+ Sibling** works even when the parents aren't known. The siblings are linked by a dashed "Parents unknown" card. Add a name to it later, or use **+ Parent**, and it becomes the real parent for all of them. You can also link existing people in the editor's **Brothers & sisters** field.
- **Undo.** Ctrl+Z (⌘Z) undoes adds, edits, deletes and imports; Ctrl+Shift+Z or Ctrl+Y redoes. There are also buttons in the top bar.
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

Without sharing set up, edits are saved only in the browser you made them in. Use **⋯ → Export backup** to keep a copy, or to move the tree to another device with **Import backup**.

With sharing set up (below), the tree lives in your own free Firebase database, and everyone with the family passcode sees and edits the same tree live.

## Sharing with family

**Privacy:**
- The family data can only be reached with the passcode. It is stretched into a long secret id that is the tree's only address, and the database rules forbid listing trees. Nothing is findable or searchable without it.
- Invite links carry the passcode after `#`, which browsers never send to any server. The site removes it from the address bar after opening.
- The site tells search engines not to index it (`noindex`). A visitor without the passcode only sees a "family passcode" screen, with no names.
- Anyone who has the passcode can view and edit, so share it only with family. Pick a long one, e.g. four random words.

**One-time setup (about 10 minutes, free):**

1. Go to <https://console.firebase.google.com> and sign in with a Google account, then click **Create a project**. Any name works (e.g. `our-family-tree`). You can turn Google Analytics off.
2. In the left menu open **Build → Firestore Database → Create database**. Choose a location near you (e.g. `asia-south1 (Mumbai)`), then **Start in production mode**.
3. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
4. Click the gear icon, then **Project settings → General → Your apps**. Click the **`</>`** (Web) icon, give it any nickname, and click **Register app**. Leave Firebase Hosting unticked.
5. Copy the `firebaseConfig = { … }` values it shows into [`config.js`](config.js), replacing `firebase: null`. These values are not secret. Commit the change, or send them to whoever maintains the site.
6. Make sure GitHub Pages serves the branch with these files (Settings → Pages).
7. Open the site in the browser that has your tree, click **Share**, choose a passcode and click **Open**. Then choose **Upload my tree … and share it**.
8. Copy the invite link, or tap **Send on WhatsApp**, and send it to family. They open it and see the tree. The passcode is remembered on their device, so they can add and edit people straight away.

The free Firebase plan (50,000 reads and 20,000 writes a day) is far more than a family needs. Export a backup now and then from the ⋯ menu, in case someone deletes something by mistake.

## Starter tree

The first load has placeholders for the known structure. Click each one to enter the real name.

- Paternal grandparents → 4 sons (the 2nd is the father)
- Maternal grandparents → 3 daughters (the 1st is the mother), then 1 son
- Father + Mother → 2 children

Fill in **Birth order** or **Birth year** so siblings appear eldest-first. Birth years also drive the cousin seniority badges and the elder/younger terms (Tau ji vs Chacha ji, Bhaiya vs by name).
