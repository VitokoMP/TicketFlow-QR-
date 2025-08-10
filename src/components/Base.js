import './Base.css'; //
import { useHB} from '../context/HeartBeatContext';
import ScanQR from '../pages/scanQR';

export default function Base() {
  const { user, permissions, api } = useHB();
  console.log("User:", user);
  console.log("Permissions:", permissions);

  if (!user?.id) {
    return <div className="tf-auth-error">Por favor inicia sesión en WordPress</div>;
  }

  return (
    <div className="ticketflow-app">
      <header className="tf-header">
        <img src={user.avatar} alt="Avatar" className="tf-avatar" />
        <h2>{user.name}</h2>
      </header>

      {permissions.canScan && (
        <section className="tf-scanner-section">
          <ScanQR api={api} />
        </section>
      )}

      {permissions.canProduce && (
        <section className="tf-producer-dashboard">
          <h3>Panel de Productor</h3>
          {/* Contenido específico para productores */}
        </section>
      )}
    </div>
  );
}