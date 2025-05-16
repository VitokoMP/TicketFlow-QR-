const handleStartScanner = async () => {
  if (loadingContext || !eventoSeleccionado?.event_id) {
    alert("Por favor, selecciona un evento válido antes de iniciar el escáner.");
    return;
  }

  try {
    setLoading(true);

    console.log("Iniciando sincronización con la API...");

    const eventId = eventoSeleccionado.event_id; // Obtener dinámicamente el ID del evento seleccionado

    const res = await fetch(`/wordpress/wp-json/ticketflow/v1/asistentes/${eventId}`, {
      method: "POST",
    });

    const data = await res.json();
    console.log("Asistentes del evento:", data);

    // Aquí podrías actualizar el contexto o el estado con los asistentes obtenidos
    // Por ejemplo: setAsistentes(data);

    if (data.success) {
      console.log("Sincronización completa:", data.message);
      await fetchEventos();
      setCameraStarted(true);
    } else {
      alert("Error al sincronizar: " + data.message);
    }
  } catch (error) {
    console.error("Error al llamar al endpoint:", error);
    alert("No se pudo iniciar el escáner. Intenta de nuevo.");
  } finally {
    setLoading(false);
  }
};