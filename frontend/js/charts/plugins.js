// Explicit ports are wired once by composition.js; this module publishes no browser globals.
export function createChartsPlugins({ document }) {
const stackedDoughnutLegend = {
    id: "stackedDoughnutLegend",
    afterUpdate(chart, _args, options) {
      const container = document.getElementById(options.containerId);
      if (!container) return;
      const list = document.createElement("ul");
      const items = chart.options.plugins.legend.labels.generateLabels(chart);
      items.forEach((item) => {
        const row = document.createElement("li");
        const button = document.createElement("button");
        const marker = document.createElement("span");
        const label = document.createElement("span");
        button.type = "button";
        button.classList.toggle("is-hidden", item.hidden);
        button.setAttribute("aria-pressed", String(!item.hidden));
        marker.className = "doughnut-legend-marker";
        marker.style.background = item.fillStyle;
        label.textContent = item.text;
        label.setAttribute("translate", "no");
        button.append(marker, label);
        if (item.share != null) {
          const share = document.createElement('span');
          share.className = 'doughnut-legend-share';
          share.setAttribute('translate', 'no'); share.textContent = item.share;
          button.append(share);
        }
        button.addEventListener("click", () => {
          chart.toggleDataVisibility(item.index);
          chart.update();
        });
        row.append(button);
        list.append(row);
      });
      container.replaceChildren(list);
    },
  };
  const FinoChartPlugins = { stackedDoughnutLegend };
return { FinoChartPlugins };
}
