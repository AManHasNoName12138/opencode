import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import assert from "node:assert/strict"
import { validateGraph } from "file:///C:/Users/shuwe/.understand-anything/repo/understand-anything-plugin/packages/core/src/schema.ts"

const root = path.resolve(import.meta.dirname, "..")
const intermediate = path.join(import.meta.dirname, "intermediate/domain-analysis.json")
const input = existsSync(intermediate) ? intermediate : path.join(import.meta.dirname, "domain-graph.json")
const result = validateGraph(JSON.parse(readFileSync(input, "utf8")))
assert(result.success && result.data, result.fatal)
assert.equal(result.issues.length, 0, JSON.stringify(result.issues))
const graph = result.data
const ids = new Set(graph.nodes.map(node => node.id))
assert.equal(ids.size, graph.nodes.length, "Duplicate node IDs")
graph.nodes.forEach(node => {
  assert.match(node.id, /^(domain|flow|step):[a-z0-9-]+(?::[a-z0-9-]+)?$/)
  assert(node.summary.trim() && node.tags.length)
  if (node.filePath) {
    const file = path.resolve(root, node.filePath)
    assert(file.startsWith(`${root}${path.sep}`), node.filePath)
    assert(existsSync(file), node.filePath)
    if (node.lineRange) {
      assert(node.lineRange[0] >= 1 && node.lineRange[1] >= node.lineRange[0], node.id)
      assert(node.lineRange[1] <= readFileSync(file, "utf8").split(/\r?\n/).length, node.id)
    }
  }
  if (node.type === "flow" || node.type === "step") {
    const type = node.type === "flow" ? "contains_flow" : "flow_step"
    assert.equal(graph.edges.filter(edge => edge.target === node.id && edge.type === type).length, 1, node.id)
  }
  if (node.type === "flow") {
    const steps = graph.edges.filter(edge => edge.source === node.id && edge.type === "flow_step")
    assert(steps.length, node.id)
    steps.forEach((edge, index) => assert(index === 0 || edge.weight > steps[index - 1].weight, node.id))
  }
})
graph.edges.forEach(edge => {
  assert.notEqual(edge.source, edge.target)
  assert(ids.has(edge.source) && ids.has(edge.target))
})
const counts = Object.fromEntries(["domain", "flow", "step"].map(type => [type, graph.nodes.filter(node => node.type === type).length]))
writeFileSync(path.join(import.meta.dirname, "domain-graph.json"), `${JSON.stringify(graph, null, 2)}\n`)
writeFileSync(path.join(import.meta.dirname, "domain-validation.json"), `${JSON.stringify({ success: true, issues: result.issues, counts, edges: graph.edges.length, sourcePathsAndLineRangesChecked: true, analyzedCommit: graph.project.gitCommitHash }, null, 2)}\n`)
console.log(JSON.stringify({ success: true, counts, edges: graph.edges.length }))
