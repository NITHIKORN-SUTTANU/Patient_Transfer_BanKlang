import { Children, cloneElement, isValidElement } from 'react'
import type { ReactElement, ReactNode, TdHTMLAttributes, HTMLAttributes } from 'react'

// Keep one semantic table on all devices; phone rows display their column labels.
export function ServiceTable({ headings, children, className = '', label = 'ตารางข้อมูล' }: { headings: string[]; children: ReactNode; className?: string; label?: string }) {
  const rows = Children.map(children, row => {
    if (!isValidElement<HTMLAttributes<HTMLTableRowElement>>(row)) return row
    const cells = Children.map(row.props.children, (cell, index) => {
      if (!isValidElement<TdHTMLAttributes<HTMLTableCellElement>>(cell)) return cell
      return cloneElement(cell as ReactElement<TdHTMLAttributes<HTMLTableCellElement> & { 'data-label'?: string }>, { 'data-label': cell.props.colSpan ? undefined : headings[index] }, cell.props.colSpan ? cell.props.children : <div className="service-cell-content">{cell.props.children}</div>)
    })
    return cloneElement(row, {}, cells)
  })
  return <div className="service-table-wrap" tabIndex={0} role="region" aria-label={label}><table className={`service-table ${className}`}><thead><tr>{headings.map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>
}
