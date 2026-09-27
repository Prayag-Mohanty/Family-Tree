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

Without sharing, edits are saved only in the browser you made them in. Use **⋯ → Export backup** to keep a copy, or to move the tree to another device with **Import backup**.

With sharing (below), the tree lives in a small database on your Vercel project. Everyone with the family passcode sees and edits the same tree, and changes appear for everyone within a few seconds.

## Sharing with family (Vercel)

The site is static files plus one small API, [`api/tree.js`](api/tree.js), which stores the tree in a free Redis database. No build step and no packages.

**Privacy:**
- The family data can only be reached with the passcode. Your browser stretches the passcode into a long secret id. That id is the tree's only address, and there is no way to list trees.
- Invite links carry the passcode after `#`, which browsers never send to any server. The site removes it from the address bar after opening.
- Search engines are told not to index the site (`noindex` headers, `robots.txt`). A visitor without the passcode only sees a "family passcode" screen, with no names.
- Anyone who has the passcode can view and edit, so share it only with family. Pick a long one, e.g. four random words.

**One-time setup (about 5 minutes, free):**

1. At <https://vercel.com/new>, import this GitHub repository. Framework preset: **Other**. No build command. Deploy.
2. In the project, open **Storage → Create Database → Upstash for Redis** (free plan). Connect it to this project for all environments. This adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` settings the API reads.
3. **Redeploy** (Deployments → ⋯ → Redeploy) so the API picks up the database.
4. Share the **production** address (e.g. `your-project.vercel.app`). Preview addresses are protected by Vercel login by default, so relatives couldn't open them. Set your production branch under Settings → Git if needed.
5. Open the production site in the browser that has your tree. Click **Share**, choose a passcode and click **Open**. Then choose **Upload my tree … and share it**. If your tree lives on another site address (e.g. GitHub Pages), first export a backup there and import it on the Vercel site.
6. Copy the invite link, or tap **Send on WhatsApp**, and send it to family. They open it and see the tree. The passcode is remembered on their device, so they can add and edit people straight away.

The free Upstash plan is far more than a family needs. Export a backup now and then from the ⋯ menu, in case someone deletes something by mistake.

## Starter tree

The first load has placeholders for the known structure. Click each one to enter the real name.

- Paternal grandparents → 4 sons (the 2nd is the father)
- Maternal grandparents → 3 daughters (the 1st is the mother), then 1 son
- Father + Mother → 2 children

Fill in **Birth order** or **Birth year** so siblings appear eldest-first. Birth years also drive the cousin seniority badges and the elder/younger terms (Tau ji vs Chacha ji, Bhaiya vs by name).
