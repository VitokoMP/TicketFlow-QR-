const handleStartScanner = async () => {
    if (loadingContext) return;

    try {
      setLoading(true);
      
      console.log('Iniciando sincronización con la API...'); // Log cuando iniciamos la sincronización

      const res = await fetch('/wp-json/mep/v1/mep_sincronizar_eventos_y_asistentes', {
        method: 'GET',
      });
      
      console.log('Respuesta de la API:', res); // Log de la respuesta de la API
      
      const data = await res.json();

      if (data.success) {
        console.log('Sincronización completa:', data.message);
        await fetchEvento(); // Llamamos a la función para cargar los eventos y asistentes
        setCameraStarted(true);
      } else {
        alert('Error al sincronizar: ' + data.message);
      }
    } catch (error) {
      console.error('Error al llamar al endpoint:', error);
      alert('No se pudo iniciar el escáner. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };