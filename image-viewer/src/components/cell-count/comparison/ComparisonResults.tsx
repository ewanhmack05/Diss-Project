import { useMemo } from 'react'
import { useComparisonContext } from '../../../context/ComparisonContext'
import { useRealtimeContext } from '../../../context/RealtimeContext'
import { compareCounts } from './compare'
import DockedCard from '../../toolbar/DockedCard'
import '../CellCounter/CellCounterToolPicker.css'
import './Comparison.css'

// The reveal. The map shows everyone's dots with a ring round each cell
// someone missed (see MapNode) - this is the numbers side of it.
function ComparisonResults() {
  const { results, closeResults } = useComparisonContext()
  const { me } = useRealtimeContext()

  const summary = useMemo(
    () =>
      results
        ? compareCounts(
            results.counters.map((c) => ({ connectionId: c.connectionId, dots: c.dots ?? [] })),
            results.settings.matchRadius
          )
        : null,
    [results]
  )
  if (!results || !summary) return null

  return (
    <div className="comparison">
      <DockedCard title="Agreement" className="comparison-card comparison-card--narrow">
        <p className="comparison-figure">
          <strong>{Math.round(summary.agreement * 100)}%</strong> agreement
        </p>
        <p className="comparison-hint comparison-hint--centred">
          {summary.agreed} of {summary.cells.length} cells found by everyone
        </p>
      </DockedCard>

      <DockedCard title="Counts" className="comparison-card">
        <table className="comparison-table">
          <thead>
            <tr>
              <th />
              <th>Count</th>
              <th title="Cells someone else found that they didn't">Missed</th>
              <th title="Cells nobody else found">Only them</th>
            </tr>
          </thead>
          <tbody>
            {results.counters.map((counter, index) => {
              const row = summary.counters[index]
              return (
                <tr key={counter.connectionId}>
                  <td className="comparison-table-name">
                    <span className="comparison-swatch" style={{ background: counter.colour }} />
                    {counter.displayName}
                    {counter.connectionId === me?.connectionId && ' (you)'}
                  </td>
                  <td>{row.count}</td>
                  <td>{row.missed}</td>
                  <td>{row.onlyThem}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="comparison-hint">
          <span className="comparison-ring" /> not everyone found this cell
        </p>
      </DockedCard>

      <DockedCard title="Actions" className="comparison-card comparison-card--narrow">
        <div className="cell-counter-tool-picker-actions cell-counter-tool-picker-actions--stacked">
          <button type="button" className="cell-counter-tool-picker-button" onClick={() => closeResults(true)}>
            Save my count
          </button>
          <button
            type="button"
            className="cell-counter-tool-picker-button cell-counter-tool-picker-button--primary"
            onClick={() => closeResults(false)}
          >
            Done
          </button>
        </div>
      </DockedCard>
    </div>
  )
}

export default ComparisonResults
