# Mahali Light / Bytecra POS — Static Front-End Demo Clone

A standalone, pixel-for-pixel static front-end demo clone of the **Mahali Light (Bytecra POS & ERP)** desktop application.

Built for sales presentations, client walkthroughs, stakeholder demos, and portfolio hosting.

---

## 🌟 Key Features of the Demo

1. **100% Client-Side & Static**:
   - Zero Electron runtime dependencies.
   - Zero real database or Node.js backend required.
   - Deployable anywhere as a static site (Vercel, Netlify, GitHub Pages, Cloudflare Pages, AWS S3).
2. **Realistic UAE Electrical POS/ERP Mock Data**:
   - Pre-populated with realistic products (cables, LED panels, switchgear, conduits, testing multimeters).
   - Multi-variant attribute matrix, inventory tracking, stock movements, and low-stock reorder alerts.
   - Customers & aging receivables ledger, suppliers & purchase orders with receiving workflows.
   - Full POS billing terminal, invoice lifecycle, UAE VAT (5%) calculation, and split payment builder.
   - Double-entry accounting charts, P&L, balance sheets, cash flow, cash drawer audits, and bank reconciliation.
   - HR & attendance time-clock, employee leaves, holidays, and role-based permissions matrix.
3. **Interactive In-Memory CRUD**:
   - All creates, updates, deletes, and status changes happen instantaneously against an in-memory state.
   - Changes persist during your session and safely reset to fresh demo data upon browser refresh.
4. **"Desktop Only" Responsive Guard**:
   - Automatically detects viewport dimensions. If width `< 1024px` or height `< 650px`, the main UI is replaced by an on-theme message prompting the user to view on a desktop/laptop or maximize the browser window.
   - Auto-restores instantly when the window is resized back above the threshold without requiring a page reload.
5. **1-Click Role Switcher on Login Page**:
   - Quickly switch between **Admin**, **Manager**, **Cashier**, and **Accountant** personas with 1 click on the `/login` screen.

---

## 🚀 How to Run Locally

Inside the `demo-frontend` folder:

```bash
# 1. Install dependencies
npm install

# 2. Start the Vite local development server
npm run dev

# 3. Build static production bundle into dist/
npm run build

# 4. Preview the production build locally
npm run preview
```

---

## 🏗️ Technical Stack

- **Framework**: React 18 (Vite)
- **Routing**: `react-router-dom` (v6)
- **Styling**: Tailwind CSS (with bespoke tokens and fonts)
- **Icons**: `lucide-react`
- **Charts & Visuals**: `recharts`
- **State Management**: `zustand`
- **Data Layer**: In-memory mock engine in `src/mock/`
