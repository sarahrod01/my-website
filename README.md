# Nursiecare · Candidate Profile Builder

This is a standalone HTML/CSS/JavaScript tool. You type candidate details into the panel on the right, and the Nursiecare candidate profile on the left updates as you type. The profile follows the layout of `MPC_webpage_profile.docx`.

It needs no server and no install. Double-click a file to open it in Chrome, Edge or Firefox.

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure and the editor panel |
| `style.css` | App styles (toolbar, editor, library, print rules) |
| `script.js` | All logic, plus the CV page design (`CV_THEME_CSS`) |
| `single-file/nursiecare-cv-builder.html` | Everything above in one file. This is the easiest one to use. |
| `build-single.py` | Rebuilds the single file after you edit the three files (`python3 build-single.py`) |

## Everyday use

- **New:** starts a candidate with the next ID (NCR-001, NCR-002, …).
- **Save** (or Ctrl+S): stores the candidate in this browser and stamps "Profile updated".
- **Candidates:** search, open or delete saved candidates.
- **Download PDF:** saves a real A4 `.pdf` file straight to Downloads. It uses two small open-source libraries (html2canvas + jsPDF), loaded from the internet only when you click. Offline, it falls back to Print. The PDF pages are images, so the text can't be selected; use Print ▸ Save as PDF if you need selectable text.
- **Print:** prints A4 pages (or choose "Save as PDF" in the print dialog). The grey `[prompts]` are hidden automatically in both.
- Open the HTML file directly in Chrome or Edge. Previews inside other apps (email, chat, file viewers) often block printing, downloads and saving.
- **More ▸** Download CV as HTML · Copy CV · Export/Import backup · Load example · Clear form · Delete.
- Click any part of the CV to jump to the matching editor section.
- **Profile checks** lists what is still missing or too long, following the template's rules.

## Where the data lives: localStorage limits

- Data is saved **only in this browser, on this computer, in this browser profile**. Other staff and other devices can't see it.
- Clearing browser data or site data, some "clean-up" tools, and private/incognito windows will lose it.
- For files opened from disk, some browsers tie storage to the file's location. **Keep the HTML file in one folder** and always open it from there.
- The limit is about 5 MB per browser, which is roughly several hundred profiles.
- Data is not encrypted and there is no login or change history. Treat the computer as holding candidate personal information.
- **Mitigation:** use *Export backup* regularly. It downloads a JSON file you can re-import on any browser.

## Code structure (ready for an API later)

`script.js` is split into five modules:

1. **CandidateModel:** the candidate JSON structure, defaults and checks.
2. **Storage:** `LocalStorageRepository` with async `list / get / save / remove / nextId / importMany`.
3. **CvRenderer:** candidate → CV blocks → paginated A4 pages. It never touches storage.
4. **FormController:** binds inputs (`data-bind="card.location"`) to the candidate object.
5. **App:** toolbar, library, print, export and toasts.

To move to a database or HubSpot, write an `ApiRepository` with the same methods (a sketch is in `script.js`) and change one line: `const Repository = ApiRepository;`.

### HubSpot path (suggested)

1. Create a small serverless function (Netlify, Vercel, Azure, etc.) that holds a HubSpot **private-app token**. Never put the token in this HTML.
2. Store each candidate as a HubSpot **Contact** (or a custom "Candidate" object on Enterprise). Map the key facts to properties, e.g. `ncr_id`, `status_badge`, `best_suited_to`, `ahpra_status`, `earliest_start`, `sponsorship`. Keep the full profile JSON in one multi-line text property so nothing is lost.
3. The function exposes `/api/candidates` (GET list, GET/PUT/DELETE by id). `ApiRepository` calls it.
4. Import existing candidates with *Export backup*, then post each record to the API.
