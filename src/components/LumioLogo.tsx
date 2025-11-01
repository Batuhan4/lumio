import styles from "./LumioLogo.module.css";

export const LumioLogo = () => (
  <div className={styles.logo} aria-label="Lumio">
    <span className={styles.logoMark} aria-hidden="true">
      <span className={styles.logoCore} />
    </span>
    <span className={styles.logoText}>Lumio</span>
  </div>
);

export default LumioLogo;
