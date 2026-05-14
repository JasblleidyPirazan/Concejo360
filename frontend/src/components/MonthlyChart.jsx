import { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const formatMes = (key) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
};

export default function MonthlyChart({ data }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-64" />;

  const labels = data.map((d) => formatMes(d.mes));
  const chartData = {
    labels,
    datasets: [
      {
        label: 'Realizadas',
        data: data.map((d) => d.Realizada),
        backgroundColor: '#16a34a',
      },
      {
        label: 'Programadas',
        data: data.map((d) => d.Programada),
        backgroundColor: '#2563eb',
      },
      {
        label: 'Pendientes',
        data: data.map((d) => d.Pendiente),
        backgroundColor: '#ca8a04',
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12 } },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { stacked: true, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
    },
  };

  return (
    <div className="h-64">
      <Bar data={chartData} options={options} />
    </div>
  );
}
