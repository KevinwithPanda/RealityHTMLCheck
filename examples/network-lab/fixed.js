fetch("orders.json", { cache: "no-store" })
  .then((response) => response.json())
  .then((orders) => {
    document.querySelector("#orders").replaceChildren(...orders.map((order) => {
      const item = document.createElement("li");
      item.textContent = `${order.id} — ${order.status}`;
      return item;
    }));
    document.querySelector("#status").textContent = `${orders.length} orders loaded.`;
  });
