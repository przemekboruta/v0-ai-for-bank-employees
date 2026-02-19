"""
Taxonomy Router - CRUD for category taxonomies.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from schemas import (
    CategoryDefinition,
    TaxonomyInfo,
    PromoteClustersRequest,
    ImportTemplateRequest,
)
from services.taxonomy_service import TaxonomyService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["taxonomy"])


class CreateTaxonomyRequest(BaseModel):
    name: str
    description: str = ""


class AddCategoryRequest(BaseModel):
    name: str
    examples: list[str] = Field(default_factory=list)
    description: str = ""


class UpdateCategoryRequest(BaseModel):
    name: str | None = None
    examples: list[str] | None = None
    description: str | None = None


# ---- Taxonomy CRUD ----


@router.post("/taxonomy")
async def create_taxonomy(req: CreateTaxonomyRequest):
    svc = TaxonomyService.get_instance()
    result = await svc.create_taxonomy(req.name, req.description)
    return result


@router.get("/taxonomy")
async def list_taxonomies():
    svc = TaxonomyService.get_instance()
    items = await svc.list_taxonomies()
    return {"taxonomies": items}


@router.get("/taxonomy/{tax_id}")
async def get_taxonomy(tax_id: str):
    svc = TaxonomyService.get_instance()
    result = await svc.get_taxonomy(tax_id)
    if not result:
        raise HTTPException(status_code=404, detail="Taxonomy not found")
    return result


@router.delete("/taxonomy/{tax_id}")
async def delete_taxonomy(tax_id: str):
    svc = TaxonomyService.get_instance()
    deleted = await svc.delete_taxonomy(tax_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Taxonomy not found")
    return {"taxonomyId": tax_id, "deleted": True}


# ---- Category CRUD ----


@router.post("/taxonomy/{tax_id}/category")
async def add_category(tax_id: str, req: AddCategoryRequest):
    svc = TaxonomyService.get_instance()
    tax = await svc.get_taxonomy(tax_id)
    if not tax:
        raise HTTPException(status_code=404, detail="Taxonomy not found")
    result = await svc.add_category(tax_id, req.name, req.examples, req.description)
    return result


@router.patch("/taxonomy/{tax_id}/category/{cat_id}")
async def update_category(tax_id: str, cat_id: str, req: UpdateCategoryRequest):
    svc = TaxonomyService.get_instance()
    result = await svc.update_category(tax_id, cat_id, req.name, req.examples, req.description)
    if not result:
        raise HTTPException(status_code=404, detail="Category not found")
    return result


@router.delete("/taxonomy/{tax_id}/category/{cat_id}")
async def delete_category(tax_id: str, cat_id: str):
    svc = TaxonomyService.get_instance()
    deleted = await svc.delete_category(tax_id, cat_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Category not found")
    return {"categoryId": cat_id, "deleted": True}


# ---- Import ----


@router.post("/taxonomy/{tax_id}/import-clusters")
async def import_clusters(tax_id: str, req: PromoteClustersRequest):
    svc = TaxonomyService.get_instance()
    tax = await svc.get_taxonomy(tax_id)
    if not tax:
        raise HTTPException(status_code=404, detail="Taxonomy not found")

    result_dict = req.clustering_result.model_dump(by_alias=True)
    added = await svc.import_from_clustering(tax_id, req.cluster_ids, result_dict)
    return {"imported": len(added), "categories": added}


@router.post("/taxonomy/{tax_id}/import-template")
async def import_template(tax_id: str, req: ImportTemplateRequest):
    svc = TaxonomyService.get_instance()
    tax = await svc.get_taxonomy(tax_id)
    if not tax:
        raise HTTPException(status_code=404, detail="Taxonomy not found")

    try:
        added = await svc.import_template(tax_id, req.template_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {"imported": len(added), "categories": added}
