const orders = document.querySelector("#orders");
const status = document.querySelector("#status");
const recovery = document.querySelector("#recovery");
const retry = document.querySelector("#retry");
const empty = document.querySelector("#empty");

async function loadOrders() {
  status.hidden = false;
  status.textContent = "Loading orders…";
  recovery.hidden = true;
  empty.hidden = true;
  orders.replaceChildren();
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const items = await response.json();
    status.hidden = true;
    if (!items.length) {
      empty.hidden = false;
      return;
    }
    for (const item of items) {
      const row = document.createElement("tr");
      for (const value of [item.id, item.owner, item.amount]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      orders.append(row);
    }
  } catch (_) {
    status.hidden = true;
    recovery.hidden = false;
  }
}

retry.addEventListener("click", loadOrders);
loadOrders();
