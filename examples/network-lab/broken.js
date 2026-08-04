fetch("missing-orders.json?access_token=network-lab-secret", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`Orders returned ${response.status}`);
    return response.json();
  })
  .catch(() => {
    document.querySelector("#status").textContent = "Orders are temporarily unavailable. Try again later.";
  });
