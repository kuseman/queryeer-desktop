package com.queryeer.backend.plugin.jdbc.sqlserver;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class SqlServerShowPlanGraphConverterTest
{
    @Test
    void convertsShowPlanRelOpsToGraph()
    {
        String xml = """
                <ShowPlanXML xmlns=\"http://schemas.microsoft.com/sqlserver/2004/07/showplan\">
                  <BatchSequence>
                    <Batch>
                      <Statements>
                        <StmtSimple StatementText=\"select 1\">
                          <QueryPlan>
                            <RelOp NodeId=\"0\" PhysicalOp=\"SELECT\" LogicalOp=\"SELECT\" EstimateRows=\"1\" EstimatedTotalSubtreeCost=\"0.1\" Parallel=\"true\">
                              <Warnings NoJoinPredicate=\"true\" />
                              <RunTimeInformation>
                                <RunTimeCountersPerThread Thread=\"0\" ActualRows=\"6\" ActualExecutions=\"1\" ActualRowsRead=\"8\" ActualElapsedms=\"2\" ActualCPUms=\"1\" />
                                <RunTimeCountersPerThread Thread=\"1\" ActualRows=\"4\" ActualExecutions=\"1\" ActualRowsRead=\"5\" ActualElapsedms=\"3\" ActualCPUms=\"2\" />
                              </RunTimeInformation>
                              <ComputeScalar>
                                <RelOp NodeId=\"1\" PhysicalOp=\"Constant Scan\" LogicalOp=\"Constant Scan\" EstimateRows=\"1\" EstimatedTotalSubtreeCost=\"0.01\">
                                  <RunTimeInformation>
                                    <RunTimeCountersPerThread Thread=\"0\" ActualRows=\"10\" ActualExecutions=\"1\" />
                                  </RunTimeInformation>
                                </RelOp>
                              </ComputeScalar>
                            </RelOp>
                          </QueryPlan>
                        </StmtSimple>
                      </Statements>
                    </Batch>
                  </BatchSequence>
                </ShowPlanXML>
                """;

        var graph = SqlServerShowPlanGraphConverter.convert(xml, "plan");

        Assertions.assertEquals("plan", graph.id());
        Assertions.assertEquals(2, graph.vertices()
                .size());
        Assertions.assertEquals(1, graph.edges()
                .size());
        Assertions.assertEquals("SELECT", graph.vertices()
                .getFirst()
                .label());
        Assertions.assertEquals(2, graph.vertices()
                .getFirst()
                .overlays()
                .size());
        Assertions.assertTrue(graph.edges()
                .getFirst()
                .style()
                .width() > 2D);
        Assertions.assertEquals("10 rows", graph.edges()
                .getFirst()
                .label());
        Assertions.assertTrue(graph.edges()
                .getFirst()
                .properties()
                .getFirst()
                .properties()
                .stream()
                .anyMatch(property -> "actualRows".equals(property.id())
                        && Double.valueOf(10D)
                                .equals(property.value())));
        var runtimeProperties = graph.vertices()
                .getFirst()
                .properties()
                .stream()
                .filter(group -> "runtime".equals(group.id()))
                .findFirst()
                .orElseThrow()
                .properties();
        Assertions.assertTrue(runtimeProperties.stream()
                .anyMatch(property -> "actualRowsRead".equals(property.id())
                        && Double.valueOf(13D)
                                .equals(property.value())));
        Assertions.assertTrue(runtimeProperties.stream()
                .anyMatch(property -> "runtimeThreadCount".equals(property.id())
                        && Double.valueOf(2D)
                                .equals(property.value())));
        Assertions.assertTrue(runtimeProperties.stream()
                .anyMatch(property -> "runtimeThread-1".equals(property.id())
                        && String.valueOf(property.value())
                                .contains("ActualCPUms=2")));
        Assertions.assertTrue(SqlServerShowPlanGraphConverter.isShowPlanXml(xml));
    }

    @Test
    void doesNotPropagateChildRuntimeInformationToParentOperators()
    {
        String xml = """
                <ShowPlanXML xmlns=\"http://schemas.microsoft.com/sqlserver/2004/07/showplan\">
                  <BatchSequence>
                    <Batch>
                      <Statements>
                        <StmtSimple StatementText=\"select 1\">
                          <QueryPlan>
                            <RelOp NodeId=\"0\" PhysicalOp=\"SELECT\" LogicalOp=\"SELECT\" EstimateRows=\"1\" EstimatedTotalSubtreeCost=\"0.1\">
                              <ComputeScalar>
                                <RelOp NodeId=\"1\" PhysicalOp=\"Constant Scan\" LogicalOp=\"Constant Scan\" EstimateRows=\"1\" EstimatedTotalSubtreeCost=\"0.01\">
                                  <RunTimeInformation>
                                    <RunTimeCountersPerThread Thread=\"0\" ActualRows=\"7\" ActualExecutions=\"1\" />
                                  </RunTimeInformation>
                                </RelOp>
                              </ComputeScalar>
                            </RelOp>
                          </QueryPlan>
                        </StmtSimple>
                      </Statements>
                    </Batch>
                  </BatchSequence>
                </ShowPlanXML>
                """;

        var graph = SqlServerShowPlanGraphConverter.convert(xml, "plan");
        var parent = graph.vertices()
                .stream()
                .filter(vertex -> "relop-0".equals(vertex.id()))
                .findFirst()
                .orElseThrow();
        var child = graph.vertices()
                .stream()
                .filter(vertex -> "relop-1".equals(vertex.id()))
                .findFirst()
                .orElseThrow();

        Assertions.assertTrue(parent.properties()
                .stream()
                .noneMatch(group -> "runtime".equals(group.id())));
        Assertions.assertTrue(child.properties()
                .stream()
                .filter(group -> "runtime".equals(group.id()))
                .flatMap(group -> group.properties()
                        .stream())
                .anyMatch(property -> "actualRows".equals(property.id())
                        && Double.valueOf(7D)
                                .equals(property.value())));
    }

    @Test
    void doesNotPropagateChildWarningsToParentOperators()
    {
        String xml = """
                <ShowPlanXML xmlns=\"http://schemas.microsoft.com/sqlserver/2004/07/showplan\">
                  <BatchSequence>
                    <Batch>
                      <Statements>
                        <StmtSimple StatementText=\"select 1\">
                          <QueryPlan>
                            <RelOp NodeId=\"0\" PhysicalOp=\"SELECT\" LogicalOp=\"SELECT\" EstimateRows=\"1\" EstimatedTotalSubtreeCost=\"0.1\">
                              <ComputeScalar>
                                <RelOp NodeId=\"1\" PhysicalOp=\"Constant Scan\" LogicalOp=\"Constant Scan\" EstimateRows=\"1\" EstimatedTotalSubtreeCost=\"0.01\">
                                  <Warnings NoJoinPredicate=\"true\" />
                                </RelOp>
                              </ComputeScalar>
                            </RelOp>
                          </QueryPlan>
                        </StmtSimple>
                      </Statements>
                    </Batch>
                  </BatchSequence>
                </ShowPlanXML>
                """;

        var graph = SqlServerShowPlanGraphConverter.convert(xml, "plan");

        var parent = graph.vertices()
                .stream()
                .filter(vertex -> "relop-0".equals(vertex.id()))
                .findFirst()
                .orElseThrow();
        var child = graph.vertices()
                .stream()
                .filter(vertex -> "relop-1".equals(vertex.id()))
                .findFirst()
                .orElseThrow();

        Assertions.assertTrue(parent.overlays()
                .isEmpty());
        Assertions.assertEquals(1, child.overlays()
                .size());
        Assertions.assertEquals("warning", child.overlays()
                .getFirst()
                .kind());
    }

    @Test
    void addsMissingIndexRecommendationsToRootProperties()
    {
        String xml = """
                <ShowPlanXML xmlns=\"http://schemas.microsoft.com/sqlserver/2004/07/showplan\">
                  <BatchSequence>
                    <Batch>
                      <Statements>
                        <StmtSimple StatementText=\"select * from dbo.Users where Email = @email\">
                          <QueryPlan>
                            <MissingIndexes>
                              <MissingIndexGroup Impact=\"82.5\">
                                <MissingIndex Database=\"[db]\" Schema=\"[dbo]\" Table=\"[Users]\">
                                  <ColumnGroup Usage=\"EQUALITY\">
                                    <Column Name=\"[Email]\" ColumnId=\"2\" />
                                  </ColumnGroup>
                                  <ColumnGroup Usage=\"INCLUDE\">
                                    <Column Name=\"[Name]\" ColumnId=\"3\" />
                                  </ColumnGroup>
                                </MissingIndex>
                              </MissingIndexGroup>
                            </MissingIndexes>
                            <RelOp NodeId=\"0\" PhysicalOp=\"SELECT\" LogicalOp=\"SELECT\" EstimateRows=\"1\" EstimatedTotalSubtreeCost=\"0.1\" />
                          </QueryPlan>
                        </StmtSimple>
                      </Statements>
                    </Batch>
                  </BatchSequence>
                </ShowPlanXML>
                """;

        var graph = SqlServerShowPlanGraphConverter.convert(xml, "plan");
        var root = graph.vertices()
                .getFirst();
        var missingIndexGroup = root.properties()
                .stream()
                .filter(group -> "missingIndexes".equals(group.id()))
                .findFirst()
                .orElseThrow();

        Assertions.assertTrue(root.overlays()
                .stream()
                .anyMatch(overlay -> "warning".equals(overlay.kind())));
        Assertions.assertTrue(missingIndexGroup.properties()
                .stream()
                .anyMatch(property -> "missingIndex-1-equality".equals(property.id())
                        && "Email".equals(property.value())));
        Assertions.assertTrue(missingIndexGroup.properties()
                .stream()
                .anyMatch(property -> "missingIndex-1-include".equals(property.id())
                        && "Name".equals(property.value())));
    }

    @Test
    void extractsPredicatesFromScalarOperatorAttributesWithoutChildPropagation()
    {
        String xml = """
                <ShowPlanXML xmlns=\"http://schemas.microsoft.com/sqlserver/2004/07/showplan\">
                  <BatchSequence>
                    <Batch>
                      <Statements>
                        <StmtSimple StatementText=\"select * from dbo.Users where Email = @email\">
                          <QueryPlan>
                            <RelOp NodeId=\"0\" PhysicalOp=\"Nested Loops\" LogicalOp=\"Inner Join\" EstimateRows=\"1\" EstimatedTotalSubtreeCost=\"0.1\">
                              <NestedLoops>
                                <RelOp NodeId=\"1\" PhysicalOp=\"Index Seek\" LogicalOp=\"Index Seek\" EstimateRows=\"1\" EstimatedTotalSubtreeCost=\"0.01\">
                                  <IndexScan>
                                    <SeekPredicates>
                                      <SeekPredicateNew>
                                        <SeekKeys>
                                          <Prefix ScanType=\"EQ\">
                                            <RangeColumns>
                                              <ColumnReference Database=\"[db]\" Schema=\"[dbo]\" Table=\"[Users]\" Column=\"Email\" />
                                            </RangeColumns>
                                            <RangeExpressions>
                                              <ScalarOperator ScalarString=\"[dbo].[Users].[Email]=[@email]\" />
                                            </RangeExpressions>
                                          </Prefix>
                                        </SeekKeys>
                                      </SeekPredicateNew>
                                    </SeekPredicates>
                                  </IndexScan>
                                </RelOp>
                                <RelOp NodeId=\"2\" PhysicalOp=\"Filter\" LogicalOp=\"Filter\" EstimateRows=\"1\" EstimatedTotalSubtreeCost=\"0.01\">
                                  <Filter>
                                    <Predicate>
                                      <ScalarOperator ScalarString=\"[dbo].[Users].[IsActive]=(1)\" />
                                    </Predicate>
                                  </Filter>
                                </RelOp>
                              </NestedLoops>
                            </RelOp>
                          </QueryPlan>
                        </StmtSimple>
                      </Statements>
                    </Batch>
                  </BatchSequence>
                </ShowPlanXML>
                """;

        var graph = SqlServerShowPlanGraphConverter.convert(xml, "plan");
        var parent = graph.vertices()
                .stream()
                .filter(vertex -> "relop-0".equals(vertex.id()))
                .findFirst()
                .orElseThrow();
        var seek = graph.vertices()
                .stream()
                .filter(vertex -> "relop-1".equals(vertex.id()))
                .findFirst()
                .orElseThrow();
        var filter = graph.vertices()
                .stream()
                .filter(vertex -> "relop-2".equals(vertex.id()))
                .findFirst()
                .orElseThrow();

        Assertions.assertTrue(parent.properties()
                .stream()
                .noneMatch(group -> "predicates".equals(group.id())));
        Assertions.assertTrue(seek.properties()
                .stream()
                .filter(group -> "predicates".equals(group.id()))
                .flatMap(group -> group.properties()
                        .stream())
                .anyMatch(property -> "seekPredicates".equals(property.id())
                        && "[dbo].[Users].[Email]=[@email]".equals(property.value())));
        Assertions.assertTrue(filter.properties()
                .stream()
                .filter(group -> "predicates".equals(group.id()))
                .flatMap(group -> group.properties()
                        .stream())
                .anyMatch(property -> "predicate".equals(property.id())
                        && "[dbo].[Users].[IsActive]=(1)".equals(property.value())));
    }
}
