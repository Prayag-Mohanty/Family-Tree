# Family Tree

One connected family tree for a large family. Find anyone, see who their parents and children are, and keep it up to date.

- **One tree.** Both sides of the family sit in a single layout. A daughter who married into another family is shown with her husband. She also appears among her own siblings as a dashed link card that jumps to her.
- **One family at a time.** Use the **View** menu (e.g. just the maternal side), or click **Show only this family** in anyone's panel. This shows a couple, all their descendants and their spouses, including daughters who married out along with their husbands and children.
- **Connectors.** Every person is linked to their parents and children. Click someone to highlight those links and open their details.
- **Families shown twice.** When someone's parents are both in the tree (e.g. a daughter who married into another family in the tree), her couple and children appear under both families. A dotted "same person" line joins her two cards.
- **Cousin seniority.** Every cousin with a birth year gets a small badge (1st, 2nd…) showing their age rank among all cousins of that generation in that family.
- **Relations.** Pick two people to see how they're related and what each calls the other in **Hindi** and **Odia** (e.g. Chacha ji / Dada, Mausi / Mausi, Tai ji / Bada Maa). Tick "the first person is me" to see a table of everyone as related to you. Terms can be edited to match how your family says them.
- **Read in Odia (ଓଡ଼ିଆ).** The **ଓଡ଼ିଆ** button in the top bar switches the whole site to Odia, including menus, the side panel, relationships ("ବାପାଙ୍କ ବଡ଼ ଭାଇ") and forms of address in Odia script (ବଡ଼ବାପା, ମାଉସୀ). Each device remembers its choice. Names stay as typed; add an Odia spelling in **Name in Odia** in the editor and it's shown to Odia readers. The translations are in `i18n.js`.
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

Without sharing, edits are saved only in the browser you made them in. Use **⋯ → Export backup** to keep a copy.

With sharing (below), the tree is saved as one private file in Vercel Blob. The family can **view** it. Only you, the editor, can **change** it.

## Sharing with family (Vercel)

The site is static files plus one small function, [`api/tree.js`](api/tree.js), which stores the tree in a private Vercel Blob store.

**Who can do what:**
- **Family passcode:** anyone you send the invite link to can view, search, see the fan chart and use Relations. They can't change anything; the edit buttons are hidden and the server refuses saves without the editor password.
- **Editor password:** you choose it when you first upload, and only you know it. The server stores only a salted hash (scrypt) and checks it on every save. On another device of yours, open the invite link, then Share → **Unlock editing**.

**Privacy:**
- The family passcode is stretched into a long secret id. That id is the tree's only address, the blob store is private, and there is no way to list trees.
- Invite links carry the passcode after `#`, which browsers never send to any server. It's removed from the address bar on open.
- Search engines are told not to index the site (`noindex` headers and `robots.txt`). Visitors without the passcode only see a passcode screen, with no names.

**Setup:**
1. Import this repository at <https://vercel.com/new> (preset **Other**).
2. **Storage → Create → Blob**. Choose **Private** access and connect the store to the project. Then redeploy.
3. Open the production address in the browser that has your tree. Click **Share**, choose a family passcode, then set your editor password and upload.
4. Send the invite link, or tap **Send on WhatsApp**.
5. To change the family passcode later, use Share → **Change the family passcode**. The old link stops working, and you send the new one.

## Views

- **Home (🏠):** where the tree opens. It shows both sets of your grandparents and their children, with the Mohanty family above the Pattnaik family. Deeper branches start folded: tap **+N** under a couple to open their children. The Home button always brings you back.
- **Tree:** everyone in one connected tree. Use **View** to pick one family, or **Everyone**.
- **Hide siblings** (⋯ menu): shows only the direct line: you, your parents, grandparents and so on, plus your own children, without aunts, uncles and cousins.
- **Fan:** a person in the middle with their parents, grandparents and great-grandparents in rings around them, father's line on the left and mother's on the right. Click anyone to move them to the middle.
- **Larger profile cards** (⋯ menu). Cards show a photo only when one has been added; otherwise just the name.
- **On phones:** search sits at the top, and a tab bar at the bottom holds Home, Tree, Fan, Relations, Share and More. The editor gets a round **+** button for adding people.

## Starter tree

The first load has placeholders for the known structure. Click each one to enter the real name.

- Paternal grandparents → 4 sons (the 2nd is the father)
- Maternal grandparents → 3 daughters (the 1st is the mother), then 1 son
- Father + Mother → 2 children

Fill in **Birth order** or **Birth year** so siblings appear eldest-first. Birth years also drive the cousin seniority badges and the elder/younger terms (Tau ji vs Chacha ji, Bhaiya vs by name).
