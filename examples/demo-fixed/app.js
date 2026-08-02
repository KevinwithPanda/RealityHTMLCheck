const rows = document.querySelector("#orders-body");
const syncStatus = document.querySelector("#sync-status");

fetch("api/orders.json")
  .then((response) => {
    if (!response.ok) throw new Error(`Orders request failed: ${response.status}`);
    return response.json();
  })
  .then((orders) => {
    if (orders.length === 0) {
      rows.innerHTML = '<tr><td class="empty-state" colspan="4">No orders need attention.</td></tr>';
      syncStatus.textContent = "Up to date";
      return;
    }
    rows.innerHTML = orders
      .map(
        (order) => `
          <tr>
            <td><strong>${order.id}</strong></td>
            <td>${order.customer}</td>
            <td><span class="order-status">${order.status}</span></td>
            <td>${order.total}</td>
          </tr>`,
      )
      .join("");
    syncStatus.textContent = "Updated just now";
  })
  .catch((error) => {
    console.error(error);
    syncStatus.textContent = "Sync failed";
  });
