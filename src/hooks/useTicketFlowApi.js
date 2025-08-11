import { useState, useEffect } from 'react';
import apiFetch from '@wordpress/api-fetch';

export function useTicketFlowAPI(actionName, requestData = {}) {
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!actionName) return;

    setLoading(true);
    apiFetch({
      url: ticketflowQR.ajax_url,
      method: 'POST',
      data: {
        action: actionName,
        _ajax_nonce: ticketflowQR.nonce,
        ...requestData,
      }
    })
      .then((res) => {
        setResponse(res);
        setLoading(false);
      })
      .catch((err) => {
        setError(err);
        setLoading(false);
      });
  }, [actionName, JSON.stringify(requestData)]); // re-ejecuta si cambia action o requestData

  return { response, loading, error };
}
