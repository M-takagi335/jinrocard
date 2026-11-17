export function onlineRequestLifetime() {
  let generation = 0
  return {
    invalidate() { generation++ },
    capture() {
      const current = generation
      return () => current === generation
    },
  }
}
