-- Migration 042: Purchase Order Comments and Reactions (Immutable discussion history)
-- Additive only: creates new tables, immutable trigger, permissions, and indexes.

-- 1. Insert permission keys
INSERT INTO permissions (key, label, module) VALUES
  ('po.comments.view', 'View Purchase Order Comments', 'supplier'),
  ('po.comments.create', 'Create Purchase Order Comments', 'supplier'),
  ('po.comments.react', 'React to Purchase Order Comments', 'supplier')
ON CONFLICT (key) DO NOTHING;

-- Grant to Admin (is_system = true AND name = 'Admin') and Manager roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE r.name IN ('Admin', 'Manager')
   AND p.key IN ('po.comments.view', 'po.comments.create', 'po.comments.react')
ON CONFLICT DO NOTHING;

-- 2. Purchase Order Comments table
CREATE TABLE IF NOT EXISTS purchase_order_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_name VARCHAR(100) NOT NULL,
  author_username VARCHAR(50),
  parent_id UUID REFERENCES purchase_order_comments(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_key VARCHAR(128),
  CONSTRAINT chk_po_comment_body_nonempty CHECK (char_length(trim(body)) > 0),
  CONSTRAINT chk_po_comment_body_length CHECK (char_length(body) <= 5000)
);

CREATE INDEX IF NOT EXISTS idx_po_comments_po ON purchase_order_comments (purchase_order_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_po_comments_parent ON purchase_order_comments (parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_po_comments_request_key ON purchase_order_comments (request_key) WHERE request_key IS NOT NULL;

-- 3. Immutability trigger for purchase_order_comments
-- Normal application operations cannot modify comment body or delete comments.
-- The only allowed UPDATE is the ON DELETE SET NULL foreign-key cascade from users(id)
-- which nulls user_id while preserving author_name, body, and all other metadata.
CREATE OR REPLACE FUNCTION po_comments_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL
       AND (to_jsonb(NEW) - 'user_id') = (to_jsonb(OLD) - 'user_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'purchase_order_comments is immutable (UPDATE blocked)';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'purchase_order_comments is immutable (DELETE blocked)';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS po_comments_immutable_trigger ON purchase_order_comments;
CREATE TRIGGER po_comments_immutable_trigger
  BEFORE UPDATE OR DELETE ON purchase_order_comments
  FOR EACH ROW EXECUTE FUNCTION po_comments_immutable();

-- 4. Purchase Order Comment Reactions table
CREATE TABLE IF NOT EXISTS purchase_order_comment_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES purchase_order_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (comment_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_po_comment_reactions_comment ON purchase_order_comment_reactions (comment_id);
