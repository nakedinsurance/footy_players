import { useMatchData } from './hooks/useMatchData'
import './index.css'

export default function App() {
  const data = useMatchData()

  return (
    <div className="min-h-screen bg-gray-950 text-green-400 p-8 font-mono">
      <h1 className="text-2xl font-bold mb-4 text-white">
        {data.teams.home.name} vs {data.teams.away.name}
      </h1>
      <pre className="text-xs overflow-auto bg-gray-900 p-4 rounded">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}
