import { Button, Icon, Layout } from "@stellar/design-system";
import ConnectAccount from "./components/ConnectAccount.tsx";
import { LumioLogo } from "./components/LumioLogo";
import { Routes, Route, Outlet, NavLink } from "react-router-dom";
import Home from "./pages/Home";
import Debugger from "./pages/Debugger.tsx";
import Wallet from "./pages/Wallet.tsx";
import History from "./pages/History.tsx";
import Developers from "./pages/Developers.tsx";
import styles from "./App.module.css";

const navLinks = [
  { to: "/", label: "Discover" },
  { to: "/wallet", label: "Wallet" },
  { to: "/history", label: "History" },
  { to: "/developers", label: "Developers" },
];

const AppLayout: React.FC = () => (
  <main className={styles.app}>
    <Layout.Header
      projectId="Lumio"
      contentCenter={
        <div className={styles.headerCenter}>
          <LumioLogo />
          <nav className={styles.nav}>
            {navLinks.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  [styles.navLink, isActive ? styles.navLinkActive : ""]
                    .join(" ")
                    .trim()
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      }
      contentRight={
        <div className={styles.headerRight}>
          <NavLink to="/debug">
            {({ isActive }) => (
              <Button variant="tertiary" size="md" disabled={isActive}>
                <Icon.Code02 size="md" />
                Debugger
              </Button>
            )}
          </NavLink>
          <ConnectAccount />
        </div>
      }
    />
    <Outlet />
    <Layout.Footer>
      <span>
        © {new Date().getFullYear()} Lumio. Licensed under the{" "}
        <a
          href="http://www.apache.org/licenses/LICENSE-2.0"
          target="_blank"
          rel="noopener noreferrer"
        >
          Apache License, Version 2.0
        </a>
        .
      </span>
    </Layout.Footer>
  </main>
);

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/history" element={<History />} />
        <Route path="/developers" element={<Developers />} />
        <Route path="/debug" element={<Debugger />} />
        <Route path="/debug/:contractName" element={<Debugger />} />
      </Route>
    </Routes>
  );
}

export default App;
